import { z } from "zod";
import { patchableContentStatusSchema, expectedUpdatedAtSchema } from "./contentSchemas";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

export const createPageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  body: z.string().trim().max(500000).default(""),
  metadata: z.record(z.unknown()).optional(),
  featuredMediaId: z.string().trim().uuid().optional(),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    body: z.string().trim().max(500000).optional(),
    metadata: z.record(z.unknown()).optional(),
    status: patchableContentStatusSchema.optional(),
    featuredMediaId: z.string().trim().uuid().nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
