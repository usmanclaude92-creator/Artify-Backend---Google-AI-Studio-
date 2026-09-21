/**
 * Public website API schemas (Phase 11 — docs/PUBLIC_API_ARCHITECTURE.md).
 * Every field here is what an anonymous visitor may legitimately send —
 * nothing here ever accepts an organizationId, ownerId, lifecycle status,
 * or any other server-controlled/internal field.
 */
import { z } from "zod";

const SORT_FIELDS = ["publishedAt", "createdAt", "title"] as const;

export const listPublicPostsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(150).optional(),
  tag: z.string().trim().max(150).optional(),
  sort: z.enum(SORT_FIELDS).default("publishedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListPublicPostsQuery = z.infer<typeof listPublicPostsQuerySchema>;

export const listPublicProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  search: z.string().trim().max(200).optional(),
  type: z.enum(["PRODUCT", "SERVICE"]).optional(),
});
export type ListPublicProductsQuery = z.infer<typeof listPublicProductsQuerySchema>;

const nonEmptyTrimmed = (max: number) => z.string().trim().min(1).max(max);

/**
 * Public lead intake (§8). Deliberately small and flat — no organizationId,
 * ownerId, status, or any other server-controlled field can be supplied by
 * the caller. `website` is a honeypot: real visitors never see or fill this
 * field (hidden via CSS on the frontend); a non-empty value is a strong bot
 * signal and the submission is silently accepted-but-discarded rather than
 * rejected (rejecting would teach a bot which field to leave blank).
 */
export const createPublicLeadSchema = z.object({
  name: nonEmptyTrimmed(200),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(50).optional(),
  subject: z.string().trim().max(200).optional(),
  message: nonEmptyTrimmed(5000),
  productInterest: z.string().trim().max(200).optional(),
  source: z.enum(["contact_form", "product_inquiry", "project_brief", "other"]).default("contact_form"),
  consent: z.literal(true, { errorMap: () => ({ message: "Consent is required to submit this form." }) }),
  website: z.string().trim().max(200).optional(),
});
export type CreatePublicLeadInput = z.infer<typeof createPublicLeadSchema>;
