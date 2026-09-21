/** Payment list/reversal schemas (Phase 10 — docs/BILLING_ARCHITECTURE.md). Payment creation lives under invoiceSchemas.ts's recordPaymentSchema (mounted at POST /invoices/:id/payments). */
import { z } from "zod";
import { paginationQuerySchema } from "./commercialSchemas";
import { paymentMethodSchema, paymentStatusSchema } from "./invoiceSchemas";

const SORT_FIELDS = ["paymentDate", "amount", "status", "createdAt"] as const;

export const listPaymentsQuerySchema = z.object({
  ...paginationQuerySchema(SORT_FIELDS, "paymentDate"),
  status: paymentStatusSchema.optional(),
  method: paymentMethodSchema.optional(),
  invoiceId: z.string().trim().uuid().optional(),
  clientId: z.string().trim().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
