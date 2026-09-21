import { z } from "zod";

export const productModuleStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE"]);

export const listProductModulesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: productModuleStatusSchema.optional(),
});
export type ListProductModulesQuery = z.infer<typeof listProductModulesQuerySchema>;

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens")
  .transform((v) => v.toUpperCase());

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");

export const createProductModuleSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10000).optional(),
  status: productModuleStatusSchema.optional(),
  isCore: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});
export type CreateProductModuleInput = z.infer<typeof createProductModuleSchema>;

export const updateProductModuleSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    status: productModuleStatusSchema.optional(),
    isCore: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateProductModuleInput = z.infer<typeof updateProductModuleSchema>;

export const reorderProductModulesSchema = z.object({
  moduleIds: z.array(z.string().trim().uuid()).min(1).max(200),
});
export type ReorderProductModulesInput = z.infer<typeof reorderProductModulesSchema>;
