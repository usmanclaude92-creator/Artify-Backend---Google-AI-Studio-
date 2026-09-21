/**
 * Client-admin workspace invitation lifecycle (Phase 6 —
 * docs/WORKSPACE_PROVISIONING.md §Invitation security). The invited role is
 * always the fixed org-level ADMIN role — never caller-supplied — so there
 * is no attacker-controlled role parameter anywhere in this flow (§20).
 */
import { prisma } from "../db/prisma";
import { workspaceRepository } from "../repositories/workspaceRepository";
import { workspaceInvitationRepository } from "../repositories/workspaceInvitationRepository";
import { roleRepository } from "../repositories/roleRepository";
import { userRepository } from "../repositories/userRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { onboardingService } from "./onboardingService";
import { hashPassword } from "../utils/password";
import { generateInvitationToken, generateSessionToken, hashToken } from "../utils/crypto";
import { AuthenticationError, ConflictError, InternalError, NotFoundError, ValidationError } from "../core/errors";
import { config } from "../config/env";
import { sanitizeUser, type SanitizedUser } from "../types/domain";
import type { CreateInvitationInput, AcceptInvitationInput } from "../schemas/invitationSchemas";
import type { RequestMeta, LoginResult } from "./authService";
import { Prisma, type WorkspaceInvitation } from "@prisma/client";

const CLIENT_ADMIN_ROLE_KEY = "ADMIN";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export function computeInvitationStatus(invite: Pick<WorkspaceInvitation, "acceptedAt" | "revokedAt" | "expiresAt">): InvitationStatus {
  if (invite.acceptedAt) return "ACCEPTED";
  if (invite.revokedAt) return "REVOKED";
  if (invite.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "PENDING";
}

async function loadWorkspaceForOwnerOrThrow(workspaceId: string, ownerOrganizationId: string) {
  const workspace = await workspaceRepository.findByIdForOwner(workspaceId, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}

export const invitationService = {
  async listInvitations(caller: SanitizedUser, workspaceId: string, page: number, limit: number) {
    await loadWorkspaceForOwnerOrThrow(workspaceId, caller.organizationId);
    const { rows, total } = await workspaceInvitationRepository.list(workspaceId, page, limit);
    return {
      rows: rows.map((r) => {
        const { tokenHash: _tokenHash, ...safe } = r;
        return { ...safe, status: computeInvitationStatus(r) };
      }),
      total,
    };
  },

  async createInvitation(caller: SanitizedUser, workspaceId: string, input: CreateInvitationInput, meta: RequestMeta = {}) {
    const workspace = await loadWorkspaceForOwnerOrThrow(workspaceId, caller.organizationId);

    const adminRole = await roleRepository.findByKey(CLIENT_ADMIN_ROLE_KEY);
    if (!adminRole) throw new InternalError("Required role configuration is missing.");

    const email = input.email.trim().toLowerCase();
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + config.invitationTokenTtlHours * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(async (tx) => {
      // A fresh invite invalidates any prior outstanding one for the same
      // (workspace, email) — at most one usable credential at a time, same
      // convention as passwordResetRepository.invalidateAllForUser. The
      // partial unique index (workspace_invitations_one_pending_per_email)
      // is the DB-level backstop if two requests race past this point.
      await tx.workspaceInvitation.updateMany({
        where: { organizationId: workspace.id, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return tx.workspaceInvitation.create({
        data: {
          organizationId: workspace.id,
          email,
          roleId: adminRole.id,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById: caller.id,
        },
      });
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      afterData: { workspaceId: workspace.id, email, roleKey: CLIENT_ADMIN_ROLE_KEY },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (workspace.provisionedForClient) {
      await onboardingService.completeStepForClient(workspace.provisionedForClient.id, "ADMINISTRATOR_INVITED", caller.id);
    }

    // Phase 13 integration point: send `token` via the email provider
    // instead of returning it here (same convention as
    // authService.requestPasswordReset). In production this is always
    // undefined; the raw token is never logged or persisted anywhere but
    // as a hash.
    return { invitation, devToken: config.isProduction ? undefined : token };
  },

  async revokeInvitation(caller: SanitizedUser, invitationId: string, meta: RequestMeta = {}): Promise<void> {
    const invitation = await workspaceInvitationRepository.findById(invitationId);
    // Ownership must be re-derived via the workspace's CRM-owner
    // relationship, not the invitation's own organizationId directly
    // (that id IS the workspace id, which the caller never owns tenant-wise
    // in the CRM sense) — resolve through workspaceRepository the same way
    // every other lookup here does.
    const workspace = invitation ? await workspaceRepository.findByIdForOwner(invitation.organizationId, caller.organizationId) : null;
    if (!invitation || !workspace) throw new NotFoundError("Invitation not found.");

    const status = computeInvitationStatus(invitation);
    if (status !== "PENDING") {
      throw new ConflictError(`This invitation is already ${status.toLowerCase()} and cannot be revoked.`);
    }

    await workspaceInvitationRepository.revoke(invitationId);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITATION_REVOKED",
      resourceType: "workspace_invitation",
      resourceId: invitationId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /** Public, unauthenticated lookup for the acceptance page (§26) — returns only what's needed to render a safe form, never the token hash or workspace internals. */
  async previewInvitation(token: string) {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new NotFoundError("This invitation link is invalid or has expired.");
    }
    const existingUser = await userRepository.findByEmail(invitation.email);
    return {
      email: invitation.email,
      workspaceName: invitation.organization.name,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt,
      requiresPassword: !existingUser,
    };
  },

  /** Transactional acceptance (§21) — race-safe against double-acceptance via a conditional updateMany, same TOCTOU-guard pattern as leadService.convertLead. */
  async acceptInvitation(token: string, input: AcceptInvitationInput, meta: RequestMeta = {}): Promise<LoginResult> {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new AuthenticationError("This invitation link is invalid or has expired.");
    }

    const existingUser = await userRepository.findByEmail(invitation.email);
    if (!existingUser && !input.password) {
      throw new ValidationError("A password is required to create your account.");
    }

    let result: Awaited<ReturnType<typeof userRepository.findByEmail>>;
    try {
      result = await prisma.$transaction(async (tx) => {
        let user = existingUser;
        if (!user) {
          const passwordHash = await hashPassword(input.password!);
          user = await tx.user.create({
            data: {
              organizationId: invitation.organizationId,
              email: invitation.email,
              passwordHash,
              firstName: input.firstName?.trim() || "Workspace",
              lastName: input.lastName?.trim() || "Administrator",
              displayName: `${input.firstName?.trim() || "Workspace"} ${input.lastName?.trim() || "Administrator"}`.trim(),
              title: "Workspace Administrator",
              roleId: invitation.roleId,
            },
          });
        }

        const existingMembership = await tx.organizationMembership.findUnique({
          where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } },
        });
        if (!existingMembership) {
          await tx.organizationMembership.create({
            data: {
              userId: user.id,
              organizationId: invitation.organizationId,
              roleId: invitation.roleId,
              status: "ACTIVE",
              isPrimary: !existingUser,
            },
          });
        }

        const accepted = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date(), acceptedUserId: user.id },
        });
        if (accepted.count !== 1) {
          // Lost a concurrent acceptance race — rolling back discards the
          // user/membership just created above.
          throw new ConflictError("This invitation has already been accepted.");
        }

        return user;
      });
    } catch (err) {
      // A concurrent acceptance for a brand-new email can also race on
      // User.email's own unique constraint (both requests see "no existing
      // user" before either commits) — caught here and folded into the
      // same clean conflict response as the invitation-row race above,
      // rather than surfacing a raw database error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This invitation has already been accepted.");
      }
      throw err;
    }
    if (!result) throw new InternalError("Invitation acceptance did not resolve a user.");

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
    await sessionRepository.create({
      token: sessionToken,
      userId: result.id,
      organizationId: invitation.organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const role = await roleRepository.resolveById(invitation.roleId);
    if (!role) throw new InternalError("Role could not be resolved.");
    const sanitized = sanitizeUser({ ...result, organizationId: invitation.organizationId }, role);

    await auditLogRepository.record({
      organizationId: invitation.organizationId,
      actorUserId: result.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_ACCEPTED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const client = await prisma.client.findUnique({ where: { workspaceOrganizationId: invitation.organizationId } });
    if (client) {
      await onboardingService.completeStepForClient(client.id, "ADMINISTRATOR_ACCEPTED", result.id);
    }

    return { session: { token: sessionToken, expiresAt }, user: sanitized };
  },
};
