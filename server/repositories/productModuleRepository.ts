/**
 * Product module data access (Phase 7 — docs/PRODUCT_MODULE_ARCHITECTURE.md).
 * Every module belongs to exactly one product; the only lookup method is
 * `findByIdForProduct(id, productId)` — never a bare `findById` — so a
 * module id from a different product is structurally unreachable (§20),
 * matching the `findByIdInOrg` convention used for tenant-owned records
 * elsewhere in this codebase.
 */
import type { ProductModule, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

export const productModuleRepository = {
  async listForProduct(productId: string, status: string | undefined, page: number, limit: number) {
    const where: Prisma.ProductModuleWhereInput = { productId };
    if (status) where.status = status as Prisma.EnumProductModuleStatusFilter["equals"];
    const [rows, total] = await Promise.all([
      prisma.productModule.findMany({
        where,
        orderBy: { displayOrder: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.productModule.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdForProduct(id: string, productId: string): Promise<ProductModule | null> {
    return prisma.productModule.findFirst({ where: { id, productId } });
  },

  /** Standalone lookup for the flat /product-modules/:id routes, which take no separate productId to cross-check against — the id itself is authoritative for the record and its true parent product, so there is no manipulation surface here (unlike the nested /products/:id/modules routes, which use findByIdForProduct). */
  async findById(id: string): Promise<ProductModule | null> {
    return prisma.productModule.findUnique({ where: { id } });
  },

  async findByCodeForProduct(productId: string, code: string): Promise<ProductModule | null> {
    return prisma.productModule.findFirst({ where: { productId, code } });
  },

  async findBySlugForProduct(productId: string, slug: string): Promise<ProductModule | null> {
    return prisma.productModule.findFirst({ where: { productId, slug } });
  },

  async findUniqueSlugForProduct(productId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "module";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugForProduct(productId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  /** Unpaginated id list for one product — used only to validate a reorder request covers exactly this product's modules (§36), never returned to a client. */
  async listAllIdsForProduct(productId: string): Promise<string[]> {
    const rows = await prisma.productModule.findMany({ where: { productId }, select: { id: true } });
    return rows.map((r) => r.id);
  },

  async maxDisplayOrder(productId: string): Promise<number> {
    const top = await prisma.productModule.findFirst({ where: { productId }, orderBy: { displayOrder: "desc" } });
    return top?.displayOrder ?? -1;
  },

  async create(data: {
    productId: string;
    code: string;
    name: string;
    slug: string;
    description?: string;
    status?: string;
    isCore?: boolean;
    displayOrder: number;
  }): Promise<ProductModule> {
    return prisma.productModule.create({
      data: {
        productId: data.productId,
        code: data.code,
        name: data.name,
        slug: data.slug,
        description: data.description,
        status: (data.status as ProductModule["status"]) ?? "DRAFT",
        isCore: data.isCore ?? false,
        displayOrder: data.displayOrder,
      },
    });
  },

  async update(id: string, data: Prisma.ProductModuleUpdateInput): Promise<ProductModule> {
    return prisma.productModule.update({ where: { id }, data });
  },

  /** All-or-nothing reorder — validated one product's worth of module ids, applied transactionally (§36). */
  async reorder(productId: string, orderedIds: string[]): Promise<void> {
    await prisma.$transaction(orderedIds.map((id, index) => prisma.productModule.update({ where: { id, productId }, data: { displayOrder: index } })));
  },
};
