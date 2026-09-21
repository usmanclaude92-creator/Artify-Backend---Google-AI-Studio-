import { z } from "zod";
import { validatePasswordPolicy } from "../utils/password";

/** Every schema that accepts a new password funnels through this — one policy, enforced once (server/utils/password.ts), not re-implemented per endpoint. */
const newPasswordSchema = z.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  }
});

export const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: newPasswordSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().min(1).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: newPasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must be different from the current password.",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().min(1).email(),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(1),
  newPassword: newPasswordSchema,
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

export const switchOrganizationSchema = z.object({
  organizationId: z.string().trim().uuid(),
});
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
