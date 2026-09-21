/** Tag data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, findByIdInOrg-only convention. */
import type { Tag, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

export const tagRepository = {
  async list(organizationId: string): Promise<Tag[]> {
    return prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Tag | null> {
    return prisma.tag.findFirst({ where: { id, organizationId } });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Tag | null> {
    return prisma.tag.findFirst({ where: { organizationId, slug } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "tag";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async findByIdsInOrg(ids: string[], organizationId: string): Promise<Tag[]> {
    if (ids.length === 0) return [];
    return prisma.tag.findMany({ where: { id: { in: ids }, organizationId } });
  },

  async create(data: { organizationId: string; name: string; slug: string }): Promise<Tag> {
    return prisma.tag.create({ data });
  },

  async update(id: string, data: Prisma.TagUpdateInput): Promise<Tag> {
    return prisma.tag.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.tag.delete({ where: { id } });
  },
};
