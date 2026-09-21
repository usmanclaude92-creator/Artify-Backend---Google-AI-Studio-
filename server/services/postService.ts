/**
 * Post management (Phase 8 — docs/CMS_ARCHITECTURE.md,
 * docs/CONTENT_WORKFLOW_ARCHITECTURE.md). Organization-scoped. Revision,
 * workflow, and optimistic-concurrency handling mirror pageService.ts
 * exactly (see its header comment); this file additionally validates and
 * applies category/tag assignment.
 */
import { postRepository, type PostWithRelations } from "../repositories/postRepository";
import { categoryRepository } from "../repositories/categoryRepository";
import { tagRepository } from "../repositories/tagRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreatePostInput, UpdatePostInput, ListPostsQuery } from "../schemas/postSchemas";
import type { ScheduleContentInput, RevertContentInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

const CONTENT_EDIT_BLOCKED_STATUSES = new Set(["PUBLISHED", "ARCHIVED"]);

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

function assertHasPublishableContent(revision: { title: string; body: string } | null): void {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This post needs a title and body before it can be published or scheduled.");
  }
}

async function loadPostOrThrow(id: string, organizationId: string): Promise<PostWithRelations> {
  const post = await postRepository.findByIdInOrg(id, organizationId);
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}

async function assertCategoryInOrg(categoryId: string | null | undefined, organizationId: string): Promise<void> {
  if (!categoryId) return;
  const category = await categoryRepository.findByIdInOrg(categoryId, organizationId);
  if (!category) throw new ValidationError("categoryId does not refer to a category in this organization.");
}

async function assertTagsInOrg(tagIds: string[] | undefined, organizationId: string): Promise<void> {
  if (!tagIds || tagIds.length === 0) return;
  const found = await tagRepository.findByIdsInOrg(tagIds, organizationId);
  if (found.length !== new Set(tagIds).size) {
    throw new ValidationError("One or more tagIds do not refer to a tag in this organization.");
  }
}

export const postService = {
  async listPosts(
    organizationId: string,
    filters: Pick<ListPostsQuery, "search" | "status" | "categoryId" | "tagId">,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ) {
    return postRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPost(organizationId: string, id: string): Promise<PostWithRelations> {
    return loadPostOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadPostOrThrow(id, organizationId);
    return postRepository.listRevisions(id);
  },

  async createPost(caller: SanitizedUser, input: CreatePostInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;

    await assertCategoryInOrg(input.categoryId, organizationId);
    await assertTagsInOrg(input.tagIds, organizationId);
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);

    if (input.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    const slug = input.slug ?? (await postRepository.findUniqueSlugInOrg(organizationId, input.title));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            categoryId: input.categoryId,
            authorId: input.authorId,
            featuredMediaId: input.featuredMediaId,
            createdById: caller.id,
          },
        });
        const revision = await tx.contentRevision.create({
          data: {
            postId: post.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.post.update({ where: { id: post.id }, data: { currentRevisionId: revision.id } });
        if (input.tagIds && input.tagIds.length > 0) {
          await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: post.id, tagId })) });
        }
        return post.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A post with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_CREATED",
      resourceType: "post",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(createdId, organizationId);
  },

  async updatePost(caller: SanitizedUser, id: string, input: UpdatePostInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    const effectiveStatus = input.status ?? existing.status;

    const hasContentEdit = input.title !== undefined || input.body !== undefined || input.metadata !== undefined || input.slug !== undefined;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES.has(effectiveStatus)) {
      throw new ConflictError(`Post content cannot be edited while status is ${effectiveStatus}.`);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    if (input.categoryId !== undefined) await assertCategoryInOrg(input.categoryId, organizationId);
    if (input.tagIds !== undefined) await assertTagsInOrg(input.tagIds, organizationId);

    // See pageService.updatePage — the featured image lives on the Post
    // row and can change independently of content edits, except on
    // ARCHIVED content.
    const hasFeaturedMediaEdit = input.featuredMediaId !== undefined;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Post content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }

    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const postPatch: Record<string, unknown> = {};
        if (input.status !== undefined) postPatch.status = input.status;
        if (input.slug !== undefined) postPatch.slug = input.slug;
        if (input.title !== undefined) postPatch.title = input.title;
        if (input.categoryId !== undefined) postPatch.categoryId = input.categoryId;
        if (input.authorId !== undefined) postPatch.authorId = input.authorId;
        if (hasFeaturedMediaEdit) postPatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) postPatch.publishedAt = null;

        if (currentRevision && (unpublishing || (hasContentEdit && currentRevision.status === "PUBLISHED"))) {
          const newRevision = await tx.contentRevision.create({
            data: {
              postId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: (input.metadata ?? currentRevision.metadata) as Prisma.InputJsonValue,
              createdById: caller.id,
            },
          });
          postPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.title !== undefined) revisionPatch.title = input.title;
          if (input.body !== undefined) revisionPatch.body = input.body;
          if (input.metadata !== undefined) revisionPatch.metadata = input.metadata as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        const willTouchTags = input.tagIds !== undefined;
        if (hasContentEdit && Object.keys(postPatch).length === 0 && !willTouchTags) {
          // See pageService.updatePage — keeps Post.updatedAt a reliable
          // optimistic-concurrency version even for a revision-only edit.
          postPatch.updatedAt = new Date();
        }

        if (Object.keys(postPatch).length > 0) {
          const where: Prisma.PostWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.post.updateMany({ where, data: postPatch });
          if (result.count === 0) {
            throw new ConflictError("This post was changed by someone else since you loaded it. Reload and try again.");
          }
        }

        if (input.tagIds !== undefined) {
          await tx.postTag.deleteMany({ where: { postId: id } });
          if (input.tagIds.length > 0) {
            await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: id, tagId })) });
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A post with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_UPDATED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "post",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return loadPostOrThrow(id, organizationId);
  },

  async submitForReview(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT post can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This post needs body content before it can be submitted for review.");
    }

    await prisma.post.update({ where: { id }, data: { status: "IN_REVIEW" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SUBMITTED_FOR_REVIEW",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async publishPost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This post has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);

    const now = new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.post.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_PUBLISHED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async schedulePost(caller: SanitizedUser, id: string, input: ScheduleContentInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    assertHasPublishableContent(existing.currentRevision);

    await prisma.post.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SCHEDULED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async archivePost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("This post is already archived.");

    await prisma.post.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_ARCHIVED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async revertPost(caller: SanitizedUser, id: string, input: RevertContentInput, meta: RequestMeta = {}): Promise<PostWithRelations> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before its content can be reverted.");

    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, postId: id } });
    if (!target) throw new NotFoundError("Revision not found on this post.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          postId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata as Prisma.InputJsonValue,
          createdById: caller.id,
        },
      });
      await tx.post.update({
        where: { id },
        data: {
          currentRevisionId: newRevision.id,
          ...(wasPublished ? { status: "DRAFT", publishedAt: null } : {}),
        },
      });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_REVERTED",
      resourceType: "post",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPostOrThrow(id, organizationId);
  },

  async deletePost(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);

    await postRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_DELETED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
