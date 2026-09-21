/**
 * Organization directory + membership management (Phase 3 —
 * docs/RBAC_IMPLEMENTATION.md). Membership mutation is the mechanism
 * through which role assignment across a tenant boundary happens — every
 * method here re-validates the caller's own relationship to the target
 * organization rather than trusting the :id path param blindly (§17).
 */
import { organizationRepository } from "../repositories/organizationRepository";
import { organizationMembershipRepository } from "../repositories/organizationMembershipRepository";
import { roleRepository } from "../repositories/roleRepository";
import { userRepository } from "../repositories/userRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { AuthorizationError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { AddMemberInput, UpdateMemberInput } from "../schemas/userSchemas";
import type { RequestMeta } from "./authService";
import { prisma } from "../db/prisma";

async function resolveRoleOrThrow(roleKey: string) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}

export const organizationService = {
  async listOrganizations(caller: SanitizedUser) {
    if (caller.role.key === "SUPER_ADMIN") {
      return prisma.organization.findMany({ orderBy: { name: "asc" } });
    }
    const memberships = await organizationMembershipRepository.listActiveForUser(caller.id);
    return memberships.map((m) => m.organization);
  },

  async getOrganization(caller: SanitizedUser, organizationId: string) {
    if (caller.role.key !== "SUPER_ADMIN") {
      const membership = await organizationMembershipRepository.findActiveMembership(caller.id, organizationId);
      if (!membership) throw new NotFoundError("Organization not found.");
    }
    const org = await organizationRepository.findById(organizationId);
    if (!org) throw new NotFoundError("Organization not found.");
    return org;
  },

  async addMember(caller: SanitizedUser, organizationId: string, input: AddMemberInput, meta: RequestMeta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }

    const targetUser = await userRepository.findById(input.userId);
    if (!targetUser) throw new NotFoundError("User not found.");

    const existing = await organizationMembershipRepository.findByUserAndOrg(input.userId, organizationId);
    if (existing) throw new ValidationError("This user is already a member of the organization.");

    const role = await resolveRoleOrThrow(input.roleKey);
    const membership = await organizationMembershipRepository.create({
      userId: input.userId,
      organizationId,
      roleId: role.id,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_ADDED",
      resourceType: "organization_membership",
      resourceId: membership.id,
      afterData: { userId: input.userId, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return membership;
  },

  async updateMember(
    caller: SanitizedUser,
    organizationId: string,
    targetUserId: string,
    input: UpdateMemberInput,
    callerPermissions: string[],
    meta: RequestMeta = {}
  ) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id && input.roleKey !== undefined) {
      throw new AuthorizationError("You cannot change your own role.");
    }

    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");

    if (input.roleKey !== undefined) {
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      const role = await resolveRoleOrThrow(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, role.id);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        beforeData: { roleKey: membership.role.key },
        afterData: { roleKey: role.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    if (input.status !== undefined) {
      await organizationMembershipRepository.updateStatus(membership.id, input.status);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "ORG_MEMBERSHIP_UPDATED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        afterData: { status: input.status },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      // No explicit session revocation here: authService.verifySession
      // re-checks live membership status on every single request, so a
      // session bound to THIS organization stops working on its very next
      // use the instant the membership is suspended — revoking all of the
      // user's sessions here would incorrectly also sign them out of
      // unrelated organizations they still have valid access to.
    }

    return organizationMembershipRepository.findById(membership.id);
  },

  async removeMember(caller: SanitizedUser, organizationId: string, targetUserId: string, meta: RequestMeta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id) {
      throw new AuthorizationError("You cannot remove your own membership.");
    }

    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");

    await organizationMembershipRepository.remove(membership.id);
    // Same reasoning as updateMember's SUSPENDED case: verifySession's
    // live membership check invalidates any session bound to this
    // organization immediately, without collaterally revoking sessions
    // the user holds in other organizations.

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_REMOVED",
      resourceType: "organization_membership",
      resourceId: targetUserId,
      beforeData: { roleKey: membership.role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
