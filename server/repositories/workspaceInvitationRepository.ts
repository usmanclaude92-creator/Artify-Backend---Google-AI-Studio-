/**
 * Client-admin workspace invitation data access (Phase 6 —
 * docs/WORKSPACE_PROVISIONING.md). Same at-rest hashing convention as
 * passwordResetRepository: the raw token is never persisted, only its
 * SHA-256 hash; callers pass the raw token and this module hashes it
 * before every read.
 */
import type { WorkspaceInvitation, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashToken } from "../utils/crypto";

export const workspaceInvitationRepository = {
  async create(data: { organizationId: string; email: string; roleId: string; token: string; expiresAt: Date; invitedById: string }) {
    return prisma.workspaceInvitation.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        roleId: data.roleId,
        tokenHash: hashToken(data.token),
        expiresAt: data.expiresAt,
        invitedById: data.invitedById,
      },
    });
  },

  /** Invalidates any prior outstanding invitation for the same (organization, email) — at most one usable credential at a time, mirroring passwordResetRepository.invalidateAllForUser. */
  async revokePendingForEmail(organizationId: string, email: string): Promise<void> {
    await prisma.workspaceInvitation.updateMany({
      where: { organizationId, email: email.trim().toLowerCase(), acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<WorkspaceInvitation | null> {
    return prisma.workspaceInvitation.findFirst({ where: { id, organizationId } });
  },

  /** No organization filter — callers must separately verify the invitation's workspace (organizationId) belongs to their tenant via workspaceRepository.findByIdForOwner, since an invitation's own organizationId IS the workspace id, not the caller's CRM-owning org. */
  async findById(id: string): Promise<WorkspaceInvitation | null> {
    return prisma.workspaceInvitation.findUnique({ where: { id } });
  },

  async findByToken(token: string) {
    return prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: true, role: true },
    });
  },

  async list(organizationId: string, page: number, limit: number) {
    const where: Prisma.WorkspaceInvitationWhereInput = { organizationId };
    const [rows, total] = await Promise.all([
      prisma.workspaceInvitation.findMany({
        where,
        include: {
          role: { select: { key: true, name: true } },
          invitedBy: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.workspaceInvitation.count({ where }),
    ]);
    return { rows, total };
  },

  async revoke(id: string): Promise<void> {
    await prisma.workspaceInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
  },
};
