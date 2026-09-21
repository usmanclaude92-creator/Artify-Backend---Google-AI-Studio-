import { z } from "zod";
import { validatePasswordPolicy } from "../utils/password";

export const createInvitationSchema = z.object({
  email: z.string().trim().min(1).email(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const listInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

const newPasswordSchema = z.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

/** For a brand-new invited identity only — an existing account never supplies these (§22/§23). */
export const acceptInvitationSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  password: newPasswordSchema.optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
