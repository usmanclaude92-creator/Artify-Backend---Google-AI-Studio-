/** Tag management (Phase 8 — docs/CMS_ARCHITECTURE.md). Organization-scoped, mirrors categoryService.ts. */
import { tagRepository } from "../repositories/tagRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateTagInput, UpdateTagInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Tag } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadTagOrThrow(id: string, organizationId: string): Promise<Tag> {
  const tag = await tagRepository.findByIdInOrg(id, organizationId);
  if (!tag) throw new NotFoundError("Tag not found.");
  return tag;
}

export const tagService = {
  async listTags(organizationId: string): Promise<Tag[]> {
    return tagRepository.list(organizationId);
  },

  async getTag(organizationId: string, id: string): Promise<Tag> {
    return loadTagOrThrow(id, organizationId);
  },

  async createTag(caller: SanitizedUser, input: CreateTagInput, meta: RequestMeta = {}): Promise<Tag> {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }
    const slug = input.slug ?? (await tagRepository.findUniqueSlugInOrg(organizationId, input.name));

    let tag: Tag;
    try {
      tag = await tagRepository.create({ organizationId, name: input.name, slug });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_CREATED",
      resourceType: "tag",
      resourceId: tag.id,
      afterData: { name: tag.name, slug: tag.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return tag;
  },

  async updateTag(caller: SanitizedUser, id: string, input: UpdateTagInput, meta: RequestMeta = {}): Promise<Tag> {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;

    let updated: Tag;
    try {
      updated = await tagRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_UPDATED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteTag(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);

    await tagRepository.delete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_DELETED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
