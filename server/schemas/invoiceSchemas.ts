/** Invoice + InvoiceItem + Payment schemas (Phase 10 — docs/BILLING_ARCHITECTURE.md). */
import { z } from "zod";
import { currencyCodeSchema, expectedUpdatedAtSchema, moneyAmountSchema, paginationQuerySchema } from "./commercialSchemas";

export const invoiceStatusSchema = z.enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "CANCELLED"]);
export const paymentMethodSchema = z.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"]);
export const paymentStatusSchema = z.enum(["PENDING", "COMPLETED", "FAILED", "REVERSED"]);

const SORT_FIELDS = ["invoiceNumber", "status", "issueDate", "dueDate", "total", "amountDue", "createdAt", "updatedAt"] as const;

export const listInvoicesQuerySchema = z.object({
  ...paginationQuerySchema(SORT_FIELDS, "issueDate"),
  status: invoiceStatusSchema.optional(),
  clientId: z.string().trim().uuid().optional(),
  contractId: z.string().trim().uuid().optional(),
  subscriptionId: z.string().trim().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

const invoiceItemInputSchema = z.object({
  productModuleId: z.string().trim().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().default(1),
  unitPrice: moneyAmountSchema,
  discount: moneyAmountSchema.default("0"),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemInputSchema>;

export const createInvoiceSchema = z.object({
  clientId: z.string().trim().uuid(),
  contractId: z.string().trim().uuid().optional(),
  subscriptionId: z.string().trim().uuid().optional(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  currency: currencyCodeSchema.optional(),
  discount: moneyAmountSchema.default("0"),
  tax: moneyAmountSchema.default("0"),
  notes: z.string().trim().max(5000).optional(),
  items: z.array(invoiceItemInputSchema).min(1, "An invoice needs at least one line item."),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Only reachable while the invoice is DRAFT (enforced in invoiceService, not here) — never invoiceNumber/currency/clientId once created. */
export const updateInvoiceSchema = z
  .object({
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    discount: moneyAmountSchema.optional(),
    tax: moneyAmountSchema.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    items: z.array(invoiceItemInputSchema).min(1).optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const issueInvoiceSchema = z.object({ expectedUpdatedAt: expectedUpdatedAtSchema });
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export const recordPaymentSchema = z.object({
  amount: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  paymentDate: z.coerce.date(),
  method: paymentMethodSchema,
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
