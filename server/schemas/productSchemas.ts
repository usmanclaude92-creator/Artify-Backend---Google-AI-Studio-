import { z } from "zod";

export const productTypeSchema = z.enum(["PRODUCT", "SERVICE"]);
export const productStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);

const SORT_FIELDS = ["name", "code", "type", "status", "displayOrder", "createdAt", "updatedAt"] as const;

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  type: productTypeSchema.optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.coerce.boolean().optional(),
  sort: z.enum(SORT_FIELDS).default("displayOrder"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens")
  .transform((v) => v.toUpperCase());

export const createProductSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
    .optional(),
  type: productTypeSchema,
  shortDescription: z.string().trim().max(300).optional(),
  description: z.string().trim().max(10000).optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)")
      .optional(),
    type: productTypeSchema.optional(),
    shortDescription: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    status: productStatusSchema.optional(),
    isFeatured: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
