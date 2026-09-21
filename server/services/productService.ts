/**
 * Product catalog management (Phase 7 — docs/PRODUCT_CATALOG_ARCHITECTURE.md).
 * Platform-global: no organization scoping (see productRepository.ts and
 * the Product model's schema.prisma doc comment). Authorization is
 * permission-gated only (products.read/create/update/archive), never a
 * per-row ownership check — there is no owning tenant to check against.
 */
import { productRepository, type ProductFilters } from "../repositories/productRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateProductInput, UpdateProductInput } from "../schemas/productSchemas";
import type { RequestMeta } from "./authService";
import type { Product } from "@prisma/client";

const TERMINAL_STATUSES = new Set(["ARCHIVED"]);
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

function assertValidTransition(current: string, next: string): void {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictError(`Product cannot move from ${current} to ${next}.`);
  }
}

async function loadProductOrThrow(id: string): Promise<Product> {
  const product = await productRepository.findById(id);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}

export const productService = {
  async listProducts(filters: ProductFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return productRepository.list(filters, page, limit, sort, order);
  },

  async getProduct(id: string): Promise<Product> {
    return loadProductOrThrow(id);
  },

  async createProduct(caller: SanitizedUser, input: CreateProductInput, meta: RequestMeta = {}): Promise<Product> {
    const existingCode = await productRepository.findByCode(input.code);
    if (existingCode) throw new ConflictError(`A product with code "${input.code}" already exists.`, { existingProductId: existingCode.id });

    let slug: string;
    if (input.slug) {
      const existingSlug = await productRepository.findBySlug(input.slug);
      if (existingSlug) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: existingSlug.id });
      slug = input.slug;
    } else {
      slug = await productRepository.findUniqueSlug(input.name);
    }

    let product: Product;
    try {
      product = await productRepository.create({
        code: input.code,
        name: input.name,
        slug,
        type: input.type,
        shortDescription: input.shortDescription,
        description: input.description,
        status: input.status,
        isFeatured: input.isFeatured,
        displayOrder: input.displayOrder,
        createdById: caller.id,
      });
    } catch (err) {
      // Concurrent creation racing on code/slug uniqueness (§49) — caught
      // here rather than surfacing a raw database error to the caller.
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this code or slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CREATED",
      resourceType: "product",
      resourceId: product.id,
      afterData: { code: product.code, name: product.name, type: product.type, status: product.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return product;
  },

  async updateProduct(caller: SanitizedUser, id: string, input: UpdateProductInput, meta: RequestMeta = {}): Promise<Product> {
    const existing = await loadProductOrThrow(id);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This product is archived and can no longer be edited.");
    }
    if (input.status !== undefined) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError('Use POST /products/:id/archive to archive a product — status cannot be set to "ARCHIVED" directly.');
      }
      assertValidTransition(existing.status, input.status);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await productRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: dup.id });
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.type !== undefined) patch.type = input.type;
    if (input.shortDescription !== undefined) patch.shortDescription = input.shortDescription;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isFeatured !== undefined) patch.isFeatured = input.isFeatured;
    if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;
    patch.updatedById = caller.id;

    let updated: Product;
    try {
      updated = await productRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_UPDATED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async archiveProduct(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<Product> {
    const existing = await loadProductOrThrow(id);
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("This product is already archived.");
    }

    // Never a physical delete (§15/§40) — historical/future commercial
    // references (Subscription.productId) always resolve.
    const archived = await productRepository.update(id, { status: "ARCHIVED", updatedBy: { connect: { id: caller.id } } });

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_ARCHIVED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return archived;
  },
};

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}
