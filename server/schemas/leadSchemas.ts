import { z } from "zod";

/** CONVERTED is reachable only via POST /leads/:id/convert (server/services/leadService.ts), never a generic PATCH — enforced again in the service, this is the first gate. */
export const leadStatusSchema = z.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  source: z.string().trim().max(100).optional(),
  assignedTo: z.string().trim().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sort: z.enum(["createdAt", "updatedAt", "companyName", "status"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const createLeadSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  source: z.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  assignedTo: z.string().trim().uuid().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    contactName: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal("")),
    phone: z.string().trim().max(50).nullable().optional(),
    source: z.string().trim().max(100).nullable().optional(),
    status: leadStatusSchema.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    assignedTo: z.string().trim().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const convertLeadSchema = z.object({
  clientCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(50).optional(),
  website: z.string().trim().max(255).optional(),
  address: z.string().trim().max(500).optional(),
  createContact: z.boolean().default(true),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
