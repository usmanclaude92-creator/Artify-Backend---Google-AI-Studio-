/**
 * Multi-org membership data access (Phase 3 —
 * docs/AUTHENTICATION_ARCHITECTURE.md). The authoritative source for "is
 * this user allowed to act in this organization, and with what role" —
 * session role resolution (authService.verifySession/login/
 * switchOrganization) and every membership-management route go through
 * here, never through User.organizationId/roleId directly.
 */
import type { Organization, OrganizationMembership, Role } from "@prisma/client";
import { prisma } from "../db/prisma";

/** Organization statuses a member may actively operate in. SUSPENDED/ARCHIVED block login and org-switching into that org, even with a valid membership row. */
const USABLE_ORGANIZATION_STATUSES = ["ACTIVE", "TRIAL"] as const;

export type ActiveMembership = OrganizationMembership & { organization: Organization; role: Role };

export const organizationMembershipRepository = {
  /** Returns the membership only if the membership itself AND the organization are both in a usable state — the single check every login/session-verification/org-switch path must use. */
  async findActiveMembership(userId: string, organizationId: string): Promise<ActiveMembership | null> {
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true },
    });
    if (!membership) return null;
    if (membership.status !== "ACTIVE") return null;
    if (!USABLE_ORGANIZATION_STATUSES.includes(membership.organization.status as (typeof USABLE_ORGANIZATION_STATUSES)[number])) {
      return null;
    }
    return membership;
  },

  async findById(id: string): Promise<(OrganizationMembership & { organization: Organization; role: Role }) | null> {
    return prisma.organizationMembership.findUnique({ where: { id }, include: { organization: true, role: true } });
  },

  async findByUserAndOrg(userId: string, organizationId: string) {
    return prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true },
    });
  },

  /** All ACTIVE memberships for a user, for GET /auth/me's org-switcher list — deliberately includes memberships in orgs the caller isn't currently "in" via their session. */
  async listActiveForUser(userId: string) {
    return prisma.organizationMembership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true, role: true },
      orderBy: { joinedAt: "asc" },
    });
  },

  /** Paginated membership listing for one organization — the basis of GET /api/v1/users' org-scoped list. */
  async listForOrganization(organizationId: string, page: number, limit: number) {
    const [rows, total] = await Promise.all([
      prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true },
        orderBy: { joinedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.organizationMembership.count({ where: { organizationId } }),
    ]);
    return { rows, total };
  },

  async create(data: {
    userId: string;
    organizationId: string;
    roleId: string;
    isPrimary?: boolean;
  }): Promise<OrganizationMembership> {
    return prisma.organizationMembership.create({
      data: {
        userId: data.userId,
        organizationId: data.organizationId,
        roleId: data.roleId,
        status: "ACTIVE",
        isPrimary: data.isPrimary ?? false,
      },
    });
  },

  async updateRole(id: string, roleId: string): Promise<OrganizationMembership> {
    return prisma.organizationMembership.update({ where: { id }, data: { roleId } });
  },

  async updateStatus(id: string, status: "ACTIVE" | "INVITED" | "SUSPENDED"): Promise<OrganizationMembership> {
    return prisma.organizationMembership.update({ where: { id }, data: { status } });
  },

  async remove(id: string): Promise<void> {
    await prisma.organizationMembership.delete({ where: { id } });
  },
};
