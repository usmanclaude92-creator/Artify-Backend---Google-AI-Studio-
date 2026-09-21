import { z } from "zod";
import { patchableContentStatusSchema, expectedUpdatedAtSchema } from "./contentSchemas";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

export const createPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  body: z.string().trim().max(500000).default(""),
  metadata: z.record(z.unknown()).optional(),
  categoryId: z.string().trim().uuid().optional(),
  authorId: z.string().trim().uuid().optional(),
  tagIds: z.array(z.string().trim().uuid()).max(50).optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const updatePostSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    body: z.string().trim().max(500000).optional(),
    metadata: z.record(z.unknown()).optional(),
    status: patchableContentStatusSchema.optional(),
    categoryId: z.string().trim().uuid().nullable().optional(),
    authorId: z.string().trim().uuid().nullable().optional(),
    tagIds: z.array(z.string().trim().uuid()).max(50).optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdatePostInput = z.infer<typeof updatePostSchema>;

export const listPostsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  categoryId: z.string().trim().uuid().optional(),
  tagId: z.string().trim().uuid().optional(),
  sort: z.enum(["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;
