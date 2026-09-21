import { z } from "zod";

export const clientStatusSchema = z.enum(["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]);

export const listClientsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  sort: z.enum(["createdAt", "updatedAt", "name", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

export const createClientSchema = z.object({
  clientCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(255).optional(),
  address: z.string().trim().max(500).optional(),
  accountManager: z.string().trim().uuid().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    legalName: z.string().trim().max(200).nullable().optional(),
    status: clientStatusSchema.optional(),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(50).nullable().optional(),
    website: z.string().trim().max(255).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    accountManager: z.string().trim().uuid().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
