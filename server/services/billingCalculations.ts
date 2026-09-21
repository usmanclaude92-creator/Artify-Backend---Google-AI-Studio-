/**
 * Centralized, authoritative financial calculation engine (Phase 10 §14 —
 * docs/BILLING_ARCHITECTURE.md). The ONLY place invoice line/total math
 * happens — invoiceService calls these functions rather than duplicating
 * the arithmetic, and nothing on the frontend performs an authoritative
 * calculation (the browser may preview a total for UX, but the server
 * always recomputes and is the only value ever persisted).
 *
 * lineTotal = round(quantity × unitPrice − discount)
 * subtotal  = round(Σ lineTotal)
 * total     = round(subtotal − invoiceDiscount + tax)
 * amountDue = round(total − amountPaid)  (amountPaid = Σ COMPLETED payments)
 */
import { addMoney, isNonNegative, multiplyMoney, subtractMoney, sumMoney, toMoney, type Money } from "../utils/money";
import { ValidationError } from "../core/errors";

export interface LineItemInput {
  quantity: number;
  unitPrice: Money;
  discount: Money;
}

export interface CalculatedLineItem extends LineItemInput {
  lineTotal: Money;
}

export function calculateLineItem(input: LineItemInput): CalculatedLineItem {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new ValidationError("Line item quantity must be a positive integer.");
  }
  const gross = multiplyMoney(input.unitPrice, input.quantity);
  const lineTotal = subtractMoney(gross, input.discount);
  if (!isNonNegative(lineTotal)) {
    throw new ValidationError("A line item's discount cannot exceed its quantity × unit price.");
  }
  return { ...input, lineTotal };
}

export interface InvoiceTotals {
  subtotal: Money;
  total: Money;
}

export function calculateInvoiceTotals(lines: CalculatedLineItem[], invoiceDiscount: Money, tax: Money): InvoiceTotals {
  const subtotal = sumMoney(lines.map((l) => l.lineTotal));
  const total = addMoney(subtractMoney(subtotal, invoiceDiscount), tax);
  if (!isNonNegative(total)) {
    throw new ValidationError("Invoice discount cannot exceed subtotal plus tax.");
  }
  return { subtotal, total };
}

/** Recomputes amountPaid/amountDue purely from persisted, COMPLETED payment rows — never trusts a cached or client-supplied value (§19). */
export function calculateInvoiceBalance(total: Money, completedPaymentAmounts: Money[]): { amountPaid: Money; amountDue: Money } {
  const amountPaid = sumMoney(completedPaymentAmounts);
  const amountDue = subtractMoney(total, amountPaid);
  return { amountPaid, amountDue: isNonNegative(amountDue) ? amountDue : toMoney(0) };
}

/** The contract's current value is always original + Σ(variation amounts) — computed here, never cached (see ContractVariation's schema doc comment). */
export function calculateContractCurrentValue(originalValue: Money, variationAmounts: Money[]): Money {
  return addMoney(originalValue, sumMoney(variationAmounts));
}

export type InvoiceStatusValue = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" | "CANCELLED";

/**
 * OVERDUE is never written to the `status` column (see Invoice's schema doc
 * comment) — it is computed here, on every read, from the persisted status
 * and due date. No background job flips a row to OVERDUE; there is nothing
 * to keep in sync because nothing is cached.
 */
export function effectiveInvoiceStatus(invoice: { status: InvoiceStatusValue; dueDate: Date }, now: Date = new Date()): InvoiceStatusValue {
  if ((invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate.getTime() < now.getTime()) {
    return "OVERDUE";
  }
  return invoice.status;
}
