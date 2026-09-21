import { z } from "zod";

export const listContactsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const listAllContactsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  clientId: z.string().trim().uuid().optional(),
});
export type ListAllContactsQuery = z.infer<typeof listAllContactsQuerySchema>;

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  jobTitle: z.string().trim().max(150).optional(),
  isPrimary: z.boolean().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(50).nullable().optional(),
    jobTitle: z.string().trim().max(150).nullable().optional(),
    isPrimary: z.boolean().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
