import { z } from "zod";

export const workspaceStatusSchema = z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]);

export const listWorkspacesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: workspaceStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListWorkspacesQuery = z.infer<typeof listWorkspacesQuerySchema>;

export const provisionWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
    .optional(),
  locale: z.string().trim().min(2).max(20).optional(),
});
export type ProvisionWorkspaceInput = z.infer<typeof provisionWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(50).nullable().optional(),
    website: z.string().trim().max(255).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    currency: z
      .string()
      .trim()
      .length(3)
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
      .optional(),
    locale: z.string().trim().min(2).max(20).optional(),
    status: workspaceStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
