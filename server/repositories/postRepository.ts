/** Post data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, same findByIdInOrg-only convention as pageRepository.ts, plus category/tag-aware filtering. */
import type { Post, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface PostFilters {
  search?: string;
  status?: string;
  categoryId?: string;
  tagId?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

const withRelations = { include: { currentRevision: true, category: true, author: true, tags: { include: { tag: true } } } } as const;
export type PostWithRelations = Prisma.PostGetPayload<typeof withRelations>;

const withPublicRelations = {
  include: {
    currentRevision: true,
    category: true,
    author: { include: { user: { select: { firstName: true, lastName: true } } } },
    tags: { include: { tag: true } },
    featuredMedia: true,
  },
} as const;
export type PostWithPublicRelations = Prisma.PostGetPayload<typeof withPublicRelations>;

function buildWhere(organizationId: string, filters: PostFilters): Prisma.PostWhereInput {
  const where: Prisma.PostWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumContentStatusFilter["equals"];
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.tagId) where.tags = { some: { tagId: filters.tagId } };
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}

export const postRepository = {
  async list(organizationId: string, filters: PostFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.post.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<PostWithRelations | null> {
    return prisma.post.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Post | null> {
    return prisma.post.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  /** Phase 11 public projection — PUBLISHED only, with category/author/tags/featured media/revision content (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId: string, slug: string): Promise<PostWithPublicRelations | null> {
    return prisma.post.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },

  /** Phase 11 public projection — PUBLISHED only, paginated, with the same relations as findPublishedBySlugWithMedia. */
  async listPublished(
    organizationId: string,
    filters: Omit<PostFilters, "status">,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: PostWithPublicRelations[]; total: number }> {
    const where = buildWhere(organizationId, { ...filters, status: "PUBLISHED" });
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withPublicRelations }),
      prisma.post.count({ where }),
    ]);
    return { rows, total };
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "post";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async listRevisions(postId: string) {
    return prisma.contentRevision.findMany({ where: { postId }, orderBy: { version: "desc" } });
  },

  async setTags(postId: string, tagIds: string[]): Promise<void> {
    await prisma.$transaction([
      prisma.postTag.deleteMany({ where: { postId } }),
      ...(tagIds.length > 0 ? [prisma.postTag.createMany({ data: tagIds.map((tagId) => ({ postId, tagId })) })] : []),
    ]);
  },

  async softDelete(id: string): Promise<void> {
    await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
