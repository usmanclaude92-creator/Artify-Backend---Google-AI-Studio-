/** Product catalog data access (Phase 7 — docs/PRODUCT_CATALOG_ARCHITECTURE.md). Platform-global — no organization scoping (see Product's schema.prisma doc comment). */
import type { Product, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface ProductFilters {
  search?: string;
  type?: string;
  status?: string;
  isFeatured?: boolean;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

function buildWhere(filters: ProductFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};
  if (filters.type) where.type = filters.type as Prisma.EnumProductTypeFilter["equals"];
  if (filters.status) where.status = filters.status as Prisma.EnumProductStatusFilter["equals"];
  if (filters.isFeatured !== undefined) where.isFeatured = filters.isFeatured;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { code: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export const productRepository = {
  async list(filters: ProductFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(filters);
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);
    return { rows, total };
  },

  async findById(id: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { id } });
  },

  async findByCode(code: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { code } });
  },

  async findBySlug(slug: string): Promise<Product | null> {
    return prisma.product.findUnique({ where: { slug } });
  },

  /** Server-generated, collision-safe (§7) — never trusts a frontend-supplied slug for uniqueness beyond a caller-requested starting point. */
  async findUniqueSlug(base: string): Promise<string> {
    const baseSlug = slugify(base) || "product";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: {
    code: string;
    name: string;
    slug: string;
    type: string;
    shortDescription?: string;
    description?: string;
    status?: string;
    isFeatured?: boolean;
    displayOrder?: number;
    createdById: string;
  }): Promise<Product> {
    return prisma.product.create({
      data: {
        code: data.code,
        name: data.name,
        slug: data.slug,
        type: data.type as Product["type"],
        shortDescription: data.shortDescription,
        description: data.description,
        status: (data.status as Product["status"]) ?? "DRAFT",
        isFeatured: data.isFeatured ?? false,
        displayOrder: data.displayOrder ?? 0,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
    });
  },

  async update(id: string, data: Prisma.ProductUpdateInput): Promise<Product> {
    return prisma.product.update({ where: { id }, data });
  },
};
