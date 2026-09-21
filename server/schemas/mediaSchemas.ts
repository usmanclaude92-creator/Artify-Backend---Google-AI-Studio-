/** Media Library schemas (Phase 9 — docs/MEDIA_ARCHITECTURE.md). */
import { z } from "zod";
import { ALLOWED_MIME_TYPES } from "../utils/fileSignature";

const SORT_FIELDS = ["originalFilename", "displayName", "mimeType", "sizeBytes", "status", "createdAt", "updatedAt"] as const;

export const listMediaQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["PENDING", "ACTIVE", "FAILED", "ARCHIVED"]).optional(),
  mimeType: z.enum(ALLOWED_MIME_TYPES).optional(),
  uploadedById: z.string().trim().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sort: z.enum(SORT_FIELDS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

export const createUploadSessionSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  displayName: z.string().trim().max(255).optional(),
  altText: z.string().trim().max(500).optional(),
  caption: z.string().trim().max(1000).optional(),
});
export type CreateUploadSessionInput = z.infer<typeof createUploadSessionSchema>;

export const completeUploadSchema = z.object({
  token: z.string().trim().min(1),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const updateMediaSchema = z
  .object({
    displayName: z.string().trim().max(255).nullable().optional(),
    altText: z.string().trim().max(500).nullable().optional(),
    caption: z.string().trim().max(1000).nullable().optional(),
    visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
