/**
 * Authentication service. Ported from the Phase 0 audit's
 * artifysolscom/server/services/authService.ts design and hardened across
 * Phase 1 (bcrypt, real sessions, transactional registration), Phase 2
 * (docs/ADR/ADR-011-permission-based-rbac-schema.md — role/permission
 * resolution via the roles/permissions/role_permissions tables instead of
 * a flat per-user array), and Phase 3 (docs/AUTHENTICATION_ARCHITECTURE.md —
 * session-scoped role resolution via OrganizationMembership rather than
 * User.roleId directly, password change/reset, logout-all, organization
 * switching).
 */
import { prisma } from "../db/prisma";
import { userRepository } from "../repositories/userRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { roleRepository } from "../repositories/roleRepository";
import { organizationMembershipRepository } from "../repositories/organizationMembershipRepository";
import { passwordResetRepository } from "../repositories/passwordResetRepository";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateSessionToken, generateResetToken } from "../utils/crypto";
import { AuthenticationError, AuthorizationError, ConflictError, InternalError } from "../core/errors";
import { sanitizeUser, type SanitizedUser, type MembershipSummary } from "../types/domain";
import type { RegisterInput } from "../schemas/authSchemas";
import { config } from "../config/env";
import { logger } from "../core/logger";
import type { User } from "@prisma/client";

/** Self-registration always creates the organization's ADMIN (not SUPER_ADMIN — that role is reserved for Artify's own platform operators, granted only via the seed/bootstrap procedure, never through the public register endpoint). */
const SELF_REGISTRATION_ROLE_KEY = "ADMIN";

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  session: { token: string; expiresAt: Date };
  user: SanitizedUser;
}

function sessionExpiry(): Date {
  return new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
}

/**
 * Resolves a SanitizedUser for a SPECIFIC organization context via that
 * user's OrganizationMembership — never via User.roleId directly. Returns
 * null if the user has no currently-usable (ACTIVE membership + ACTIVE/
 * TRIAL organization) access to that organization, which callers must
 * treat as "this session/request is no longer valid" (e.g. an admin
 * removed the membership after the session was issued).
 */
async function resolveSanitizedUserForOrganization(user: User, organizationId: string): Promise<SanitizedUser | null> {
  const membership = await organizationMembershipRepository.findActiveMembership(user.id, organizationId);
  if (!membership) return null;

  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) {
    // A membership with no resolvable role is a data-integrity bug, not a
    // normal auth failure — role_id is NOT NULL + RESTRICT.
    throw new InternalError("User role could not be resolved.");
  }

  return sanitizeUser({ ...user, organizationId }, role);
}

export const authService = {
  async login(email: string, password: string, meta: RequestMeta = {}, targetOrganizationId?: string): Promise<LoginResult> {
    const user = await userRepository.findByEmail(email);

    // Same generic error whether the email doesn't exist or the password is
    // wrong — do not let a caller distinguish "no such account" from
    // "wrong password" (user-enumeration hardening).
    const genericFailure = () => new AuthenticationError("Invalid email or password credentials.");

    if (!user) throw genericFailure();

    if (userRepository.isLocked(user)) {
      throw new AuthenticationError(
        "This account is temporarily locked due to repeated failed sign-in attempts. Try again later."
      );
    }

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      const nowLocked = await userRepository.recordFailedLogin(user.id);
      await auditLogRepository.record({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorType: "USER",
        action: "AUTH_LOGIN_FAILED",
        resourceType: "session",
        resourceId: user.id,
        result: "FAILURE",
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      if (nowLocked) {
        logger.warn({ event: "account_locked", userId: user.id }, "Account locked after repeated failed logins");
        await auditLogRepository.record({
          organizationId: user.organizationId,
          actorUserId: user.id,
          actorType: "USER",
          action: "AUTH_ACCOUNT_LOCKED",
          resourceType: "user",
          resourceId: user.id,
          result: "FAILURE",
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      throw genericFailure();
    }

    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("This account cannot sign in. Contact your administrator.");
    }

    const organizationId = targetOrganizationId ?? user.organizationId;
    const sanitized = await resolveSanitizedUserForOrganization(user, organizationId);
    if (!sanitized) {
      throw new AuthenticationError("This account does not have active access to the requested organization.");
    }

    await userRepository.recordSuccessfulLogin(user.id);

    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: user.id,
      actorName: sanitized.displayName ?? `${user.firstName} ${user.lastName}`,
      actorType: "USER",
      action: "AUTH_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { session: { token, expiresAt }, user: sanitized };
  },

  async register(payload: RegisterInput): Promise<LoginResult> {
    const existing = await userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictError("An account with this email address already exists.");
    }

    const adminRole = await roleRepository.findByKey(SELF_REGISTRATION_ROLE_KEY);
    if (!adminRole) {
      // The ADMIN system role must exist (seeded) before self-registration
      // can work at all — a missing seed is an operational error, not a
      // normal user-facing failure.
      throw new InternalError("Registration is not available: required role configuration is missing.");
    }

    const passwordHash = await hashPassword(payload.password);

    // Single atomic transaction: organization + admin user + membership are
    // created together or not at all (Phase 1 hardening, unchanged in
    // Phase 2/3). Self-registration can never assign SUPER_ADMIN — the role
    // used here is always the fixed ADMIN constant above, never
    // caller-supplied (Phase 3 §10).
    await prisma.$transaction(async (tx) => {
      const baseSlug =
        payload.organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 80) || "organization";

      let slug = baseSlug;
      let suffix = 1;
      while (await tx.organization.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
        if (suffix > 50) break;
      }

      const organization = await tx.organization.create({
        data: {
          name: payload.organizationName,
          slug,
          type: "CLIENT",
          tier: "GROWTH",
          status: "TRIAL",
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: payload.email.trim().toLowerCase(),
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          displayName: `${payload.firstName} ${payload.lastName}`.trim(),
          title: "Organization Administrator",
          roleId: adminRole.id,
        },
      });

      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          roleId: adminRole.id,
          status: "ACTIVE",
          isPrimary: true,
        },
      });

      return { organization, user };
    });

    return this.login(payload.email, payload.password);
  },

  async verifySession(token: string): Promise<SanitizedUser | null> {
    const session = await sessionRepository.findValidByToken(token);
    if (!session) return null;

    const user = await userRepository.findById(session.userId);
    if (!user || user.status !== "ACTIVE") return null;

    // If the organization membership backing this session has since been
    // revoked/suspended (or the organization itself deactivated), the
    // session must stop working immediately — do not trust a session's
    // stored organizationId once it was issued; re-verify on every request.
    const sanitized = await resolveSanitizedUserForOrganization(user, session.organizationId);
    if (!sanitized) return null;

    void sessionRepository.touchLastUsed(session.id); // fire-and-forget, not on the request's critical path

    return sanitized;
  },

  async logout(token: string, actor?: { userId: string; organizationId: string }, meta: RequestMeta = {}): Promise<void> {
    await sessionRepository.revoke(token);
    if (actor) {
      await auditLogRepository.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorType: "USER",
        action: "AUTH_LOGOUT",
        resourceType: "session",
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }
  },

  /** Revokes every active session for the user (all devices/tabs) — a broader action than logout(), which only revokes the caller's current session. */
  async logoutAll(user: SanitizedUser, meta: RequestMeta = {}): Promise<void> {
    await sessionRepository.revokeAllForUser(user.id);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_LOGOUT_ALL",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async changePassword(
    user: SanitizedUser,
    currentSessionToken: string,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta = {}
  ): Promise<void> {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");

    const validCurrent = await verifyPassword(currentPassword, fullUser.passwordHash);
    if (!validCurrent) {
      throw new AuthenticationError("Current password is incorrect.");
    }

    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);

    // Revoke every OTHER active session — a password change is a strong
    // security-relevant event, other devices/sessions should not remain
    // trusted on the old credential. The session used to authenticate
    // *this* request is kept: it just proved fresh knowledge of the
    // (now-previous) password, so forcing an immediate re-login here would
    // add friction without a security benefit.
    await sessionRepository.revokeAllForUserExcept(user.id, currentSessionToken);

    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_CHANGE",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /**
   * Always resolves without revealing whether the email exists (§12
   * enumeration hardening). Returns a `devToken` ONLY outside production —
   * the safe development/test mechanism the brief asks for in place of a
   * real email provider (Phase 13). In production this is always
   * undefined; the raw token is never logged, never included in a
   * production response, and never persisted anywhere but as a hash.
   */
  async requestPasswordReset(email: string, meta: RequestMeta = {}): Promise<{ devToken?: string }> {
    const user = await userRepository.findByEmail(email);
    if (!user || user.status !== "ACTIVE") {
      return {};
    }

    await passwordResetRepository.invalidateAllForUser(user.id);

    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMinutes * 60 * 1000);
    await passwordResetRepository.create({
      token,
      userId: user.id,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Phase 13 integration point: send `token` via the email provider
    // instead of returning it here. Until then, non-production callers get
    // it back directly so the reset flow is testable end-to-end.
    return config.isProduction ? {} : { devToken: token };
  },

  async confirmPasswordReset(token: string, newPassword: string, meta: RequestMeta = {}): Promise<void> {
    const resetRow = await passwordResetRepository.findValidByToken(token);
    if (!resetRow) {
      throw new AuthenticationError("This password reset link is invalid or has expired.");
    }

    const user = await userRepository.findById(resetRow.userId);
    if (!user) {
      throw new InternalError("Reset token references a user that no longer exists.");
    }

    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);
    await passwordResetRepository.markUsed(resetRow.id);
    await passwordResetRepository.invalidateAllForUser(user.id);

    // A password reset means the previous credential may have been
    // compromised — revoke every session everywhere, not just the caller's.
    await sessionRepository.revokeAllForUser(user.id);

    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /**
   * Switches the caller's active session to a different organization they
   * hold active membership in (§18). Never trusts the target organizationId
   * without re-verifying membership; permissions are recalculated from
   * that organization's role, not carried over. Implemented as session
   * rotation (new token issued, old one revoked) rather than mutating the
   * existing session row in place.
   */
  async switchOrganization(
    user: SanitizedUser,
    currentSessionToken: string,
    targetOrganizationId: string,
    meta: RequestMeta = {}
  ): Promise<LoginResult> {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");

    const sanitized = await resolveSanitizedUserForOrganization(fullUser, targetOrganizationId);
    if (!sanitized) {
      throw new AuthorizationError("You do not have active access to the requested organization.");
    }

    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId: targetOrganizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await sessionRepository.revoke(currentSessionToken);

    await auditLogRepository.record({
      organizationId: targetOrganizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_ORGANIZATION_SWITCH",
      resourceType: "session",
      resourceId: user.id,
      beforeData: { organizationId: user.organizationId },
      afterData: { organizationId: targetOrganizationId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { session: { token, expiresAt }, user: sanitized };
  },

  /** The org-switcher list for GET /auth/me — every organization the user can currently switch into. */
  async listMemberships(userId: string, currentOrganizationId: string): Promise<MembershipSummary[]> {
    const memberships = await organizationMembershipRepository.listActiveForUser(userId);
    return memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      roleKey: m.role.key,
      roleName: m.role.name,
      isPrimary: m.isPrimary,
      isCurrent: m.organizationId === currentOrganizationId,
    }));
  },
};
