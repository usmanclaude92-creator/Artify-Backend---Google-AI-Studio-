/** Subscription + SubscriptionItem schemas (Phase 10 — docs/BILLING_ARCHITECTURE.md). */
import { z } from "zod";
import { currencyCodeSchema, expectedUpdatedAtSchema, moneyAmountSchema, paginationQuerySchema } from "./commercialSchemas";

export const subscriptionStatusSchema = z.enum(["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"]);
export const billingCycleSchema = z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"]);

const SORT_FIELDS = ["subscriptionNumber", "status", "startDate", "renewalDate", "createdAt", "updatedAt"] as const;

export const listSubscriptionsQuerySchema = z.object({
  ...paginationQuerySchema(SORT_FIELDS, "createdAt"),
  status: subscriptionStatusSchema.optional(),
  clientId: z.string().trim().uuid().optional(),
  productId: z.string().trim().uuid().optional(),
});
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;

const subscriptionItemInputSchema = z.object({
  productModuleId: z.string().trim().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().default(1),
  unitPrice: moneyAmountSchema,
});

export const createSubscriptionSchema = z.object({
  clientId: z.string().trim().uuid(),
  productId: z.string().trim().uuid(),
  startDate: z.coerce.date(),
  billingCycle: billingCycleSchema,
  quantity: z.number().int().positive().default(1),
  price: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  items: z.array(subscriptionItemInputSchema).default([]),
});
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

/** Never status/clientId/productId/billingCycle/currency — status is dedicated-endpoint-only (§34). */
export const updateSubscriptionSchema = z
  .object({
    renewalDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    quantity: z.number().int().positive().optional(),
    price: moneyAmountSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
