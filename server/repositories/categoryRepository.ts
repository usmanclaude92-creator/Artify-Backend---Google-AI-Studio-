/** Category data access (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, findByIdInOrg-only convention. */
import type { Category, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

export const categoryRepository = {
  async list(organizationId: string): Promise<Category[]> {
    return prisma.category.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Category | null> {
    return prisma.category.findFirst({ where: { id, organizationId } });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Category | null> {
    return prisma.category.findFirst({ where: { organizationId, slug } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "category";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: { organizationId: string; name: string; slug: string; description?: string }): Promise<Category> {
    return prisma.category.create({ data });
  },

  async update(id: string, data: Prisma.CategoryUpdateInput): Promise<Category> {
    return prisma.category.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.category.delete({ where: { id } });
  },
};
