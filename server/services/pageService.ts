/**
 * Page management (Phase 8 — docs/CMS_ARCHITECTURE.md,
 * docs/CONTENT_WORKFLOW_ARCHITECTURE.md). Organization-scoped.
 *
 * Workflow: DRAFT -> IN_REVIEW -> PUBLISHED -> ARCHIVED, and
 * IN_REVIEW -> SCHEDULED -> PUBLISHED, each a dedicated, permission-gated,
 * content-validated endpoint (submitForReview/publishPage/schedulePage/
 * archivePage) — never reachable through the generic PATCH, which only
 * ever moves status back to DRAFT (reopen for editing) plus content-field
 * edits. See docs/CONTENT_WORKFLOW_ARCHITECTURE.md for the full state
 * machine and why each transition is its own method.
 *
 * Revisions: a revision is immutable once published at the application
 * layer (schema.prisma's own doc comment on ContentRevision). A content
 * edit mutates the current revision in place unless that revision's own
 * status is PUBLISHED (checked on the revision, not the page, so a page
 * restored from ARCHIVED with a still-PUBLISHED current revision is still
 * handled correctly) or the edit accompanies an unpublish, in which case
 * editing clones a new DRAFT revision instead. revertPage always clones a
 * new revision from history — it never mutates or deletes a past one.
 *
 * Optimistic concurrency (§12): Page.updatedAt doubles as the page's
 * version. Every content edit touches the Page row (even one that only
 * changes the current revision's own fields) specifically so updatedAt
 * stays a reliable version for "this page and its current draft" as a
 * whole. When a PATCH supplies expectedUpdatedAt, the write is a
 * conditional `updateMany` keyed on (id, updatedAt) — the same race-safe
 * conditional-update-plus-row-count pattern used for lead conversion and
 * workspace provisioning — so a stale write affects zero rows and is
 * reported as a 409, never silently lost.
 */
import { pageRepository, type PageWithRevision } from "../repositories/pageRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreatePageInput, UpdatePageInput } from "../schemas/pageSchemas";
import type { ScheduleContentInput, RevertContentInput } from "../schemas/contentSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

const CONTENT_EDIT_BLOCKED_STATUSES = new Set(["PUBLISHED", "ARCHIVED"]);

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

function assertHasPublishableContent(revision: { title: string; body: string } | null): void {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This page needs a title and body before it can be published or scheduled.");
  }
}

async function loadPageOrThrow(id: string, organizationId: string): Promise<PageWithRevision> {
  const page = await pageRepository.findByIdInOrg(id, organizationId);
  if (!page) throw new NotFoundError("Page not found.");
  return page;
}

export const pageService = {
  async listPages(
    organizationId: string,
    filters: { search?: string; status?: string },
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ) {
    return pageRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPage(organizationId: string, id: string): Promise<PageWithRevision> {
    return loadPageOrThrow(id, organizationId);
  },

  async listRevisions(organizationId: string, id: string) {
    await loadPageOrThrow(id, organizationId);
    return pageRepository.listRevisions(id);
  },

  async createPage(caller: SanitizedUser, input: CreatePageInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;

    if (input.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    const slug = input.slug ?? (await pageRepository.findUniqueSlugInOrg(organizationId, input.title));

    let createdId: string;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: { organizationId, slug, title: input.title, status: "DRAFT", createdById: caller.id, featuredMediaId: input.featuredMediaId },
        });
        const revision = await tx.contentRevision.create({
          data: {
            pageId: page.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            createdById: caller.id,
          },
        });
        await tx.page.update({ where: { id: page.id }, data: { currentRevisionId: revision.id } });
        return page.id;
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A page with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_CREATED",
      resourceType: "page",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(createdId, organizationId);
  },

  async updatePage(caller: SanitizedUser, id: string, input: UpdatePageInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    // Schema restricts input.status to "DRAFT" — every other status is
    // dedicated-endpoint-only (submitForReview/schedulePage/publishPage/
    // archivePage). Moving to DRAFT is always a legal "reopen" from any
    // other status.
    const effectiveStatus = input.status ?? existing.status;

    const hasContentEdit = input.title !== undefined || input.body !== undefined || input.metadata !== undefined || input.slug !== undefined;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES.has(effectiveStatus)) {
      throw new ConflictError(`Page content cannot be edited while status is ${effectiveStatus}.`);
    }

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }

    // The featured image lives on the Page row, not the revision — it can
    // be changed independently of content edits (e.g. while PUBLISHED),
    // except on ARCHIVED content, which stays fully read-only (§24).
    const hasFeaturedMediaEdit = input.featuredMediaId !== undefined;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Page content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }

    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;

    try {
      await prisma.$transaction(async (tx) => {
        const pagePatch: Record<string, unknown> = {};
        if (input.status !== undefined) pagePatch.status = input.status;
        if (input.slug !== undefined) pagePatch.slug = input.slug;
        if (input.title !== undefined) pagePatch.title = input.title;
        if (hasFeaturedMediaEdit) pagePatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) pagePatch.publishedAt = null;

        if (currentRevision && (unpublishing || (hasContentEdit && currentRevision.status === "PUBLISHED"))) {
          // The current revision has actually gone live — never mutate it
          // (immutability invariant). Clone it into a fresh DRAFT revision,
          // applying this request's content edits (if any) on top.
          const newRevision = await tx.contentRevision.create({
            data: {
              pageId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: (input.metadata ?? currentRevision.metadata) as Prisma.InputJsonValue,
              createdById: caller.id,
            },
          });
          pagePatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch: Record<string, unknown> = {};
          if (input.title !== undefined) revisionPatch.title = input.title;
          if (input.body !== undefined) revisionPatch.body = input.body;
          if (input.metadata !== undefined) revisionPatch.metadata = input.metadata as Prisma.InputJsonValue;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }

        if (hasContentEdit && Object.keys(pagePatch).length === 0) {
          // Every content edit must touch the Page row — even one that
          // only changed the current revision's own fields — so
          // Page.updatedAt stays a reliable optimistic-concurrency version
          // for "this page and its current draft" as a whole (§12).
          pagePatch.updatedAt = new Date();
        }

        if (Object.keys(pagePatch).length > 0) {
          const where: Prisma.PageWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
          const result = await tx.page.updateMany({ where, data: pagePatch });
          if (result.count === 0) {
            throw new ConflictError("This page was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A page with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_UPDATED",
      resourceType: "page",
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
        resourceType: "page",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return loadPageOrThrow(id, organizationId);
  },

  async submitForReview(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT page can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This page needs body content before it can be submitted for review.");
    }

    await prisma.page.update({ where: { id }, data: { status: "IN_REVIEW" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SUBMITTED_FOR_REVIEW",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async publishPage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This page has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);

    const now = new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.page.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } }),
    ]);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_PUBLISHED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async schedulePage(caller: SanitizedUser, id: string, input: ScheduleContentInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    assertHasPublishableContent(existing.currentRevision);

    await prisma.page.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SCHEDULED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async archivePage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("This page is already archived.");

    // Never a physical delete, and the current revision (published or not)
    // is left exactly as-is — archiving preserves history, it doesn't
    // rewrite it.
    await prisma.page.update({ where: { id }, data: { status: "ARCHIVED" } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_ARCHIVED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async revertPage(caller: SanitizedUser, id: string, input: RevertContentInput, meta: RequestMeta = {}): Promise<PageWithRevision> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before its content can be reverted.");

    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, pageId: id } });
    if (!target) throw new NotFoundError("Revision not found on this page.");

    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      // Revert MUST create a new revision (§11) — it never mutates or
      // deletes the target or the outgoing current revision, so the full
      // history stays intact.
      const newRevision = await tx.contentRevision.create({
        data: {
          pageId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata as Prisma.InputJsonValue,
          createdById: caller.id,
        },
      });
      await tx.page.update({
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
      action: "PAGE_REVERTED",
      resourceType: "page",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPageOrThrow(id, organizationId);
  },

  async deletePage(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);

    await pageRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_DELETED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
