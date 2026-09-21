/** Shared commercial/billing schema fragments (Phase 10 — docs/BILLING_ARCHITECTURE.md). Contract/Subscription/Invoice/Payment schemas each compose these, matching the existing per-domain shared-fragment convention (contentSchemas.ts). */
import { z } from "zod";
import { DEFAULT_CURRENCY } from "../utils/money";

/** Optimistic-concurrency guard (§37) — same pattern as contentSchemas.ts's expectedUpdatedAtSchema. */
export const expectedUpdatedAtSchema = z.coerce.date().optional();

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
  .default(DEFAULT_CURRENCY);

/** A non-negative monetary amount, as a decimal string with at most 3 fractional digits — never a JS number, to avoid float round-tripping before it even reaches Prisma.Decimal. */
export const moneyAmountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a non-negative number with at most 3 decimal places" });

/** A signed monetary amount (contract variations may reduce a contract's value). */
export const signedMoneyAmountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a number with at most 3 decimal places" });

const SORT_ORDER = ["asc", "desc"] as const;

export function paginationQuerySchema(sortFields: readonly [string, ...string[]], defaultSort: string, defaultOrder: "asc" | "desc" = "desc") {
  return {
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().max(200).optional(),
    sort: z.enum(sortFields).default(defaultSort as (typeof sortFields)[number]),
    order: z.enum(SORT_ORDER).default(defaultOrder),
  };
}
