/**
 * Workspace data access (Phase 6 — docs/WORKSPACE_PROVISIONING.md). A
 * "workspace" is NOT a new tenant model — it is a normal Organization row
 * (type=CLIENT) that a CRM Client was provisioned into, identified by the
 * reverse `provisionedForClient` relation. Every list/lookup here is
 * scoped to the CRM-owning organization (the caller's own organizationId,
 * i.e. which Artify-platform tenant's CRM this client belongs to) via that
 * relation — never a bare `organization.findUnique` with no ownership
 * check, matching the findByIdInOrg convention used elsewhere.
 */
import type { Organization, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface WorkspaceFilters {
  status?: string;
  search?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function buildWhere(ownerOrganizationId: string, filters: WorkspaceFilters): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = {
    provisionedForClient: { organizationId: ownerOrganizationId },
  };
  if (filters.status) where.status = filters.status as Prisma.EnumOrganizationStatusFilter["equals"];
  if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };
  return where;
}

export const workspaceRepository = {
  async list(ownerOrganizationId: string, filters: WorkspaceFilters, page: number, limit: number) {
    const where = buildWhere(ownerOrganizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: { provisionedForClient: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.organization.count({ where }),
    ]);
    return { rows, total };
  },

  /** The single ownership-scoped lookup method — a workspace id belonging to another tenant's CRM is invisible, not just filtered client-side. */
  async findByIdForOwner(id: string, ownerOrganizationId: string) {
    return prisma.organization.findFirst({
      where: { id, provisionedForClient: { organizationId: ownerOrganizationId } },
      include: { provisionedForClient: true },
    });
  },

  async findUniqueSlug(baseName: string): Promise<string> {
    const baseSlug = slugify(baseName) || "workspace";
    let slug = baseSlug;
    let attempt = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async update(id: string, data: Prisma.OrganizationUpdateInput): Promise<Organization> {
    return prisma.organization.update({ where: { id }, data });
  },

  async countMembers(organizationId: string): Promise<number> {
    return prisma.organizationMembership.count({ where: { organizationId } });
  },
};
