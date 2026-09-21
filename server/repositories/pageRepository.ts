/** Page data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, same findByIdInOrg-only convention as leadRepository.ts. */
import type { Page, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface PageFilters {
  search?: string;
  status?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

const withCurrentRevision = { include: { currentRevision: true } } as const;
export type PageWithRevision = Prisma.PageGetPayload<typeof withCurrentRevision>;

const withPublicRelations = { include: { currentRevision: true, featuredMedia: true } } as const;
export type PageWithPublicRelations = Prisma.PageGetPayload<typeof withPublicRelations>;

function buildWhere(organizationId: string, filters: PageFilters): Prisma.PageWhereInput {
  const where: Prisma.PageWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const pageRepository = {
  async list(organizationId: string, filters: PageFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.page.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<PageWithRevision | null> {
    return prisma.page.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Page | null> {
    return prisma.page.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  /** Phase 11 public projection — PUBLISHED only, with the revision content and featured media needed to render the page (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId: string, slug: string): Promise<PageWithPublicRelations | null> {
    return prisma.page.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "page";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(pageId: string) {
    return prisma.contentRevision.findMany({ where: { pageId }, orderBy: { version: "desc" } });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.page.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
