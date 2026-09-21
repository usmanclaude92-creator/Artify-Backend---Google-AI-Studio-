/** Author profile schemas (Phase 8 — docs/CMS_ARCHITECTURE.md §Authors). Platform-global, mirrors productSchemas.ts's shape for a global resource. */
import { z } from "zod";

export const createAuthorSchema = z.object({
  userId: z.string().trim().uuid(),
  bio: z.string().trim().max(2000).optional(),
  avatarUrl: z.string().trim().url().max(500).optional(),
});
export type CreateAuthorInput = z.infer<typeof createAuthorSchema>;

export const updateAuthorSchema = z
  .object({
    bio: z.string().trim().max(2000).nullable().optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateAuthorInput = z.infer<typeof updateAuthorSchema>;
