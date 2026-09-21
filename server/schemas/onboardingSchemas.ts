import { z } from "zod";

export const ONBOARDING_CHECKLIST_KEYS = [
  "CLIENT_VERIFIED",
  "WORKSPACE_CREATED",
  "PRIMARY_CONTACT_CONFIRMED",
  "ADMINISTRATOR_INVITED",
  "ADMINISTRATOR_ACCEPTED",
  "WORKSPACE_CONFIGURED",
  "ONBOARDING_COMPLETED",
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_CHECKLIST_KEYS)[number];

export const listOnboardingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]).optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListOnboardingQuery = z.infer<typeof listOnboardingQuerySchema>;

export const updateOnboardingSchema = z
  .object({
    completeStep: z.enum(ONBOARDING_CHECKLIST_KEYS).optional(),
    status: z.enum(["CANCELLED"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;
