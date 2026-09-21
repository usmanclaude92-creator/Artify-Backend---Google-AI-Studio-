/**
 * Product module management (Phase 7 — docs/PRODUCT_MODULE_ARCHITECTURE.md).
 * Every module operation re-derives its parent product — never trusts a
 * request-supplied productId/moduleId pairing without checking it against
 * the database (§20/§36).
 */
import { productRepository } from "../repositories/productRepository";
import { productModuleRepository } from "../repositories/productModuleRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateProductModuleInput, UpdateProductModuleInput } from "../schemas/productModuleSchemas";
import type { RequestMeta } from "./authService";
import type { Product, ProductModule } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadProductOrThrow(productId: string): Promise<Product> {
  const product = await productRepository.findById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}

async function loadModuleOrThrow(id: string): Promise<ProductModule> {
  const module_ = await productModuleRepository.findById(id);
  if (!module_) throw new NotFoundError("Product module not found.");
  return module_;
}

export const productModuleService = {
  async listModulesForProduct(productId: string, status: string | undefined, page: number, limit: number) {
    await loadProductOrThrow(productId);
    return productModuleRepository.listForProduct(productId, status, page, limit);
  },

  async getModule(id: string): Promise<ProductModule> {
    return loadModuleOrThrow(id);
  },

  async createModule(caller: SanitizedUser, productId: string, input: CreateProductModuleInput, meta: RequestMeta = {}): Promise<ProductModule> {
    const product = await loadProductOrThrow(productId);
    if (product.status === "ARCHIVED") {
      throw new ConflictError("Cannot add a module to an archived product.");
    }

    const existingCode = await productModuleRepository.findByCodeForProduct(productId, input.code);
    if (existingCode) throw new ConflictError(`A module with code "${input.code}" already exists on this product.`);

    let slug: string;
    if (input.slug) {
      const existingSlug = await productModuleRepository.findBySlugForProduct(productId, input.slug);
      if (existingSlug) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
      slug = input.slug;
    } else {
      slug = await productModuleRepository.findUniqueSlugForProduct(productId, input.name);
    }

    const displayOrder = input.displayOrder ?? (await productModuleRepository.maxDisplayOrder(productId)) + 1;

    let module_: ProductModule;
    try {
      module_ = await productModuleRepository.create({
        productId,
        code: input.code,
        name: input.name,
        slug,
        description: input.description,
        status: input.status,
        isCore: input.isCore,
        displayOrder,
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A module with this code or slug already exists on this product.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_CREATED",
      resourceType: "product_module",
      resourceId: module_.id,
      afterData: { productId, code: module_.code, name: module_.name, status: module_.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return module_;
  },

  async updateModule(caller: SanitizedUser, id: string, input: UpdateProductModuleInput, meta: RequestMeta = {}): Promise<ProductModule> {
    const existing = await loadModuleOrThrow(id);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await productModuleRepository.findBySlugForProduct(existing.productId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
    }
    if (input.status === "INACTIVE" && existing.isCore) {
      // Core modules may still be deactivated via the dedicated archive
      // action (an explicit, audited choice) — but not silently through a
      // generic field update that could be missed in review.
      throw new ValidationError('Use POST /product-modules/:id/archive to deactivate a core module.');
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isCore !== undefined) patch.isCore = input.isCore;
    if (input.displayOrder !== undefined) patch.displayOrder = input.displayOrder;

    let updated: ProductModule;
    try {
      updated = await productModuleRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A module with this slug already exists on this product.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_UPDATED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async archiveModule(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ProductModule> {
    const existing = await loadModuleOrThrow(id);
    if (existing.status === "INACTIVE") {
      throw new ConflictError("This module is already inactive.");
    }

    // Safe archive (§14/§19): never a physical delete — a future
    // SubscriptionItem.productModuleId reference always resolves.
    const archived = await productModuleRepository.update(id, { status: "INACTIVE" });

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_ARCHIVED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return archived;
  },

  /** Transactional, all-or-nothing reorder — validates every id belongs to this exact product before applying anything (§36). */
  async reorderModules(caller: SanitizedUser, productId: string, moduleIds: string[], meta: RequestMeta = {}): Promise<void> {
    await loadProductOrThrow(productId);

    const existingIds = await productModuleRepository.listAllIdsForProduct(productId);
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(moduleIds);

    if (moduleIds.length !== existingIds.length || existingIds.some((id) => !requestedSet.has(id)) || moduleIds.some((id) => !existingSet.has(id))) {
      throw new ValidationError("The reorder request must include exactly this product's current modules, each exactly once.");
    }

    await productModuleRepository.reorder(productId, moduleIds);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_REORDERED",
      resourceType: "product",
      resourceId: productId,
      afterData: { order: moduleIds },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
