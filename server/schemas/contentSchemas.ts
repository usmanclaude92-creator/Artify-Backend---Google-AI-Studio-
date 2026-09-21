/** Shared CMS schema fragments (Phase 8 — docs/CMS_ARCHITECTURE.md). Page/Post each compose these, matching the existing per-resource schema file convention. */
import { z } from "zod";

export const contentStatusSchema = z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);

/**
 * The only status reachable through the generic PATCH status field. Every
 * other forward transition (submit-review, schedule, publish, archive) has
 * its own dedicated endpoint with its own permission tier and content
 * validation — matching the leads.CONVERTED / products.ARCHIVED precedent,
 * extended here to every workflow step, not just the terminal one. PATCH
 * still covers the "back" moves this schema's target allows: IN_REVIEW,
 * SCHEDULED, PUBLISHED, or ARCHIVED -> DRAFT.
 */
export const patchableContentStatusSchema = z.enum(["DRAFT"]);

/** Optimistic-concurrency guard (§12) — when supplied, the update is rejected with 409 unless the resource's updatedAt still matches, preventing a silent lost update. */
export const expectedUpdatedAtSchema = z.coerce.date().optional();

export const revertContentSchema = z.object({
  revisionId: z.string().trim().uuid(),
});
export type RevertContentInput = z.infer<typeof revertContentSchema>;

const SORT_FIELDS = ["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"] as const;

export const listContentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: contentStatusSchema.optional(),
  sort: z.enum(SORT_FIELDS).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListContentQuery = z.infer<typeof listContentQuerySchema>;

export const scheduleContentSchema = z.object({
  scheduledAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), { message: "scheduledAt must be in the future" }),
});
export type ScheduleContentInput = z.infer<typeof scheduleContentSchema>;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema.optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  slug: slugSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
