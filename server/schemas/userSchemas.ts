import { z } from "zod";
import { SYSTEM_ROLE_KEYS } from "../types/domain";
import { validatePasswordPolicy } from "../utils/password";

const newPasswordSchema = z.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

/** Roles assignable through the admin API. SUPER_ADMIN is deliberately
 * excluded — that role is granted only via the seed/bootstrap procedure
 * (server/services/userService.ts enforces this again at runtime; this
 * schema is the first, not the only, gate). */
export const assignableRoleKeySchema = z.enum(
  SYSTEM_ROLE_KEYS.filter((k) => k !== "SUPER_ADMIN") as [string, ...string[]]
);

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  organizationId: z.string().trim().uuid().optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: newPasswordSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  title: z.string().trim().max(150).optional(),
  roleKey: assignableRoleKeySchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().max(150).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    status: z.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
    roleKey: assignableRoleKeySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const addMemberSchema = z.object({
  userId: z.string().trim().uuid(),
  roleKey: assignableRoleKeySchema,
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z
  .object({
    roleKey: assignableRoleKeySchema.optional(),
    status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
