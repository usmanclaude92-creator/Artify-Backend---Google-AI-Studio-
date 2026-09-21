/** Contract + ContractVariation schemas (Phase 10 — docs/COMMERCIAL_ARCHITECTURE.md). */
import { z } from "zod";
import { currencyCodeSchema, expectedUpdatedAtSchema, moneyAmountSchema, paginationQuerySchema, signedMoneyAmountSchema } from "./commercialSchemas";

export const contractStatusSchema = z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]);

const SORT_FIELDS = ["contractNumber", "title", "status", "startDate", "endDate", "createdAt", "updatedAt"] as const;

export const listContractsQuerySchema = z.object({
  ...paginationQuerySchema(SORT_FIELDS, "createdAt"),
  status: contractStatusSchema.optional(),
  clientId: z.string().trim().uuid().optional(),
});
export type ListContractsQuery = z.infer<typeof listContractsQuerySchema>;

export const createContractSchema = z.object({
  clientId: z.string().trim().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  contractValue: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

/** Never status/contractValue/currency/clientId — status is dedicated-endpoint-only (§34), value changes only through variations (§5). */
export const updateContractSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const terminateContractSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type TerminateContractInput = z.infer<typeof terminateContractSchema>;

export const createContractVariationSchema = z.object({
  amount: signedMoneyAmountSchema,
  effectiveDate: z.coerce.date(),
  reason: z.string().trim().min(1).max(1000),
});
export type CreateContractVariationInput = z.infer<typeof createContractVariationSchema>;
