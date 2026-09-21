/** Category management (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, mirrors leadService.ts's tenant-isolation shape. */
import { categoryRepository } from "../repositories/categoryRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateCategoryInput, UpdateCategoryInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Category } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadCategoryOrThrow(id: string, organizationId: string): Promise<Category> {
  const category = await categoryRepository.findByIdInOrg(id, organizationId);
  if (!category) throw new NotFoundError("Category not found.");
  return category;
}

export const categoryService = {
  async listCategories(organizationId: string): Promise<Category[]> {
    return categoryRepository.list(organizationId);
  },

  async getCategory(organizationId: string, id: string): Promise<Category> {
    return loadCategoryOrThrow(id, organizationId);
  },

  async createCategory(caller: SanitizedUser, input: CreateCategoryInput, meta: RequestMeta = {}): Promise<Category> {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    const slug = input.slug ?? (await categoryRepository.findUniqueSlugInOrg(organizationId, input.name));

    let category: Category;
    try {
      category = await categoryRepository.create({ organizationId, name: input.name, slug, description: input.description });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_CREATED",
      resourceType: "category",
      resourceId: category.id,
      afterData: { name: category.name, slug: category.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return category;
  },

  async updateCategory(caller: SanitizedUser, id: string, input: UpdateCategoryInput, meta: RequestMeta = {}): Promise<Category> {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;

    let updated: Category;
    try {
      updated = await categoryRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A category with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_UPDATED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteCategory(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);

    await categoryRepository.delete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_DELETED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
