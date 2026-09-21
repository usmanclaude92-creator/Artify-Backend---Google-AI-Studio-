/**
 * User management within an organization (Phase 3 —
 * docs/RBAC_IMPLEMENTATION.md). Every operation here is scoped to the
 * caller's CURRENT session organization (`req.organizationId`) unless the
 * caller is SUPER_ADMIN — never to an organizationId supplied in the
 * request body/query by a non-SUPER_ADMIN caller (§17: never trust a
 * caller-supplied organizationId for a privileged action).
 */
import { userRepository } from "../repositories/userRepository";
import { organizationMembershipRepository } from "../repositories/organizationMembershipRepository";
import { roleRepository } from "../repositories/roleRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { hashPassword } from "../utils/password";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../core/errors";
import { sanitizeUser, type SanitizedUser } from "../types/domain";
import type { CreateUserInput, UpdateUserInput } from "../schemas/userSchemas";
import type { RequestMeta } from "./authService";
import type { User } from "@prisma/client";

type ProfilePatch = Partial<Pick<User, "firstName" | "lastName" | "title" | "phone" | "status">>;

async function resolveRoleOrThrow(roleKey: string) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}

/** Confirms the target user has ACTIVE membership in `organizationId` and returns their sanitized shape for that org's role — used by list/get/update so a caller can never reach a user outside their own organization, even by guessing a valid user id (§17). */
async function loadUserInOrgOrThrow(userId: string, organizationId: string): Promise<SanitizedUser> {
  const membership = await organizationMembershipRepository.findByUserAndOrg(userId, organizationId);
  if (!membership) throw new NotFoundError("User not found.");

  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found.");

  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) throw new NotFoundError("User not found.");

  return sanitizeUser({ ...user, organizationId }, role);
}

export const userService = {
  async listUsers(organizationId: string, page: number, limit: number) {
    const { rows, total } = await organizationMembershipRepository.listForOrganization(organizationId, page, limit);
    const users = rows.map((m) => sanitizeUser({ ...m.user, organizationId }, { id: m.role.id, key: m.role.key, name: m.role.name, permissions: [] }));
    return { users, total };
  },

  async getUser(organizationId: string, userId: string): Promise<SanitizedUser> {
    return loadUserInOrgOrThrow(userId, organizationId);
  },

  async createUser(
    caller: SanitizedUser,
    input: CreateUserInput,
    meta: RequestMeta = {}
  ): Promise<SanitizedUser> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError("An account with this email address already exists.");

    const role = await resolveRoleOrThrow(input.roleKey);
    const passwordHash = await hashPassword(input.password);

    const user = await userRepository.create({
      organizationId: caller.organizationId,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      title: input.title,
      roleId: role.id,
    });

    await organizationMembershipRepository.create({
      userId: user.id,
      organizationId: caller.organizationId,
      roleId: role.id,
      isPrimary: true,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: user.id,
      afterData: { email: user.email, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return sanitizeUser({ ...user, organizationId: caller.organizationId }, { id: role.id, key: role.key, name: role.name, permissions: [] });
  },

  async updateUser(
    caller: SanitizedUser,
    targetUserId: string,
    input: UpdateUserInput,
    callerPermissions: string[],
    meta: RequestMeta = {}
  ): Promise<SanitizedUser> {
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, caller.organizationId);
    if (!membership) throw new NotFoundError("User not found.");

    const beforeRoleKey = membership.role.key;

    if (input.roleKey !== undefined) {
      // Role assignment is a distinct privilege from general profile
      // updates (§19/§23) — requirePermission("users.update") alone is not
      // enough to change a role.
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      // Never let a caller change their own role via this endpoint — self-
      // escalation prevention (§24: "Do not allow users to grant
      // themselves permissions"), unconditional, including for SUPER_ADMIN.
      if (targetUserId === caller.id) {
        throw new AuthorizationError("You cannot change your own role.");
      }

      const newRole = await resolveRoleOrThrow(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, newRole.id);

      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "user",
        resourceId: targetUserId,
        beforeData: { roleKey: beforeRoleKey },
        afterData: { roleKey: newRole.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    const profilePatch: ProfilePatch = {};
    if (input.firstName !== undefined) profilePatch.firstName = input.firstName;
    if (input.lastName !== undefined) profilePatch.lastName = input.lastName;
    if (input.title !== undefined) profilePatch.title = input.title;
    if (input.phone !== undefined) profilePatch.phone = input.phone;
    if (input.status !== undefined) profilePatch.status = input.status;

    if (Object.keys(profilePatch).length > 0) {
      await userRepository.updateProfile(targetUserId, profilePatch);

      if (input.status !== undefined) {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_STATUS_CHANGED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: { status: input.status },
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        });
        if (input.status === "DISABLED") {
          // Deactivating an account must not leave existing sessions usable.
          await sessionRepository.revokeAllForUser(targetUserId);
        }
      } else {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_UPDATED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: profilePatch,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        });
      }
    }

    return loadUserInOrgOrThrow(targetUserId, caller.organizationId);
  },
};
