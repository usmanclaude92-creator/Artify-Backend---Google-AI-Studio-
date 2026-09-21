/**
 * Invoice lifecycle + payments (Phase 10 — docs/BILLING_ARCHITECTURE.md).
 * Organization-scoped. All line/total math goes through
 * billingCalculations.ts — nothing here duplicates that arithmetic.
 * Status is server-controlled only: DRAFT is freely editable, issue/void
 * are dedicated endpoints, and PARTIALLY_PAID/PAID are derived purely from
 * persisted Payment rows (never set directly by a caller). Payment
 * recording/reversal row-locks the parent Invoice (`SELECT ... FOR
 * UPDATE`) inside a transaction because both operations read a computed
 * sum (Σ completed payments) and validate against it before writing — a
 * plain conditional `updateMany` cannot express "the new total must not
 * exceed the outstanding balance" (§37/§19).
 */
import { invoiceRepository, type InvoiceFilters, type InvoiceWithDetails } from "../repositories/invoiceRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { clientRepository } from "../repositories/clientRepository";
import { contractRepository } from "../repositories/contractRepository";
import { subscriptionRepository } from "../repositories/subscriptionRepository";
import { productModuleRepository } from "../repositories/productModuleRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { calculateInvoiceBalance, calculateInvoiceTotals, calculateLineItem, effectiveInvoiceStatus, type InvoiceStatusValue } from "./billingCalculations";
import { assertSameCurrency, isPositive, toMoney, DEFAULT_CURRENCY, type Money } from "../utils/money";
import { nextInvoiceNumber } from "../utils/sequence";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateInvoiceInput, InvoiceItemInput, IssueInvoiceInput, RecordPaymentInput, UpdateInvoiceInput, VoidInvoiceInput } from "../schemas/invoiceSchemas";
import type { RequestMeta } from "./authService";
import type { Payment, Prisma } from "@prisma/client";

const ISSUABLE_FROM = ["DRAFT"];
const PAYABLE_STATUSES = ["ISSUED", "PARTIALLY_PAID"];

export interface InvoiceWithEffectiveStatus extends InvoiceWithDetails {
  effectiveStatus: InvoiceStatusValue;
}

function withEffectiveStatus(invoice: InvoiceWithDetails): InvoiceWithEffectiveStatus {
  return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
}

function statusForBalance(amountPaid: Money, amountDue: Money): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}

async function loadInvoiceOrThrow(id: string, organizationId: string): Promise<InvoiceWithDetails> {
  const invoice = await invoiceRepository.findByIdInOrg(id, organizationId);
  if (!invoice) throw new NotFoundError("Invoice not found.");
  return invoice;
}

async function buildLineItems(items: InvoiceItemInput[], productId: string | undefined) {
  const calculated = items.map((item) => calculateLineItem({ quantity: item.quantity, unitPrice: toMoney(item.unitPrice), discount: toMoney(item.discount) }));
  for (const item of items) {
    if (item.productModuleId && productId) {
      const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, productId);
      if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the linked subscription's product.`);
    }
  }
  return items.map((item, i) => ({
    productModuleId: item.productModuleId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: calculated[i]!.unitPrice,
    discount: calculated[i]!.discount,
    lineTotal: calculated[i]!.lineTotal,
  }));
}

export const invoiceService = {
  async listInvoices(organizationId: string, filters: InvoiceFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const { rows, total } = await invoiceRepository.list(organizationId, filters, page, limit, sort, order);
    // The list row shape has no items/payments (a full InvoiceWithDetails
    // fetch per row would be an N+1 query) — but effectiveStatus only needs
    // status + dueDate, both already present, so it's still computed here
    // rather than leaving list rows without it (§19 — OVERDUE must never
    // require a separate detail fetch to see).
    return { rows: rows.map((row) => ({ ...row, effectiveStatus: effectiveInvoiceStatus(row) })), total };
  },

  async getInvoice(organizationId: string, id: string): Promise<InvoiceWithEffectiveStatus> {
    return withEffectiveStatus(await loadInvoiceOrThrow(id, organizationId));
  },

  async createInvoice(caller: SanitizedUser, input: CreateInvoiceInput, meta: RequestMeta = {}): Promise<InvoiceWithEffectiveStatus> {
    const organizationId = caller.organizationId;
    const client = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client) throw new ValidationError("The specified client does not exist in this organization.");

    let productId: string | undefined;
    if (input.contractId) {
      const contract = await contractRepository.findByIdInOrg(input.contractId, organizationId);
      if (!contract || contract.clientId !== input.clientId) throw new ValidationError("The specified contract does not belong to this client.");
    }
    if (input.subscriptionId) {
      const subscription = await subscriptionRepository.findByIdInOrg(input.subscriptionId, organizationId);
      if (!subscription || subscription.clientId !== input.clientId) throw new ValidationError("The specified subscription does not belong to this client.");
      productId = subscription.productId;
    }

    if (input.dueDate.getTime() < input.issueDate.getTime()) {
      throw new ValidationError("dueDate cannot be before issueDate.");
    }

    const currency = input.currency ?? DEFAULT_CURRENCY;
    const lines = await buildLineItems(input.items, productId);
    const calculatedLines = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal }));
    const { subtotal, total } = calculateInvoiceTotals(calculatedLines, toMoney(input.discount), toMoney(input.tax));
    const { amountDue } = calculateInvoiceBalance(total, []);

    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await invoiceRepository.create(
      {
        invoiceNumber,
        organizationId,
        clientId: input.clientId,
        contractId: input.contractId,
        subscriptionId: input.subscriptionId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency,
        subtotal,
        tax: toMoney(input.tax),
        discount: toMoney(input.discount),
        total,
        amountDue,
        notes: input.notes,
        createdById: caller.id,
      },
      lines
    );

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_CREATED",
      resourceType: "invoice",
      resourceId: invoice.id,
      afterData: { invoiceNumber, clientId: input.clientId, total: total.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return withEffectiveStatus(invoice);
  },

  async updateInvoice(caller: SanitizedUser, id: string, input: UpdateInvoiceInput, meta: RequestMeta = {}): Promise<InvoiceWithEffectiveStatus> {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") {
      throw new ConflictError("Only a DRAFT invoice can be edited — once issued, an invoice is immutable (correct via credit/void instead).");
    }

    const issueDate = input.issueDate ?? existing.issueDate;
    const dueDate = input.dueDate ?? existing.dueDate;
    if (dueDate.getTime() < issueDate.getTime()) throw new ValidationError("dueDate cannot be before issueDate.");

    await prisma.$transaction(async (tx) => {
      const patch: Record<string, unknown> = {};
      if (input.issueDate !== undefined) patch.issueDate = input.issueDate;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      if (input.notes !== undefined) patch.notes = input.notes;

      let lines = existing.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, lineTotal: item.lineTotal }));
      if (input.items !== undefined) {
        const built = await buildLineItems(input.items, undefined);
        await invoiceRepository.replaceItems(tx, id, built);
        lines = built;
      }

      const discount = input.discount !== undefined ? toMoney(input.discount) : existing.discount;
      const tax = input.tax !== undefined ? toMoney(input.tax) : existing.tax;
      const { subtotal, total } = calculateInvoiceTotals(lines, discount, tax);
      const { amountDue } = calculateInvoiceBalance(total, []);
      patch.discount = discount;
      patch.tax = tax;
      patch.subtotal = subtotal;
      patch.total = total;
      patch.amountDue = amountDue;

      const where: Prisma.InvoiceWhereInput = {
        id,
        status: "DRAFT",
        ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}),
      };
      const result = await tx.invoice.updateMany({ where, data: patch });
      if (result.count === 0) {
        throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");
      }
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_UPDATED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getInvoice(organizationId, id);
  },

  async issueInvoice(caller: SanitizedUser, id: string, input: IssueInvoiceInput, meta: RequestMeta = {}): Promise<InvoiceWithEffectiveStatus> {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.items.length === 0) throw new ValidationError("An invoice needs at least one line item before it can be issued.");

    const where: Prisma.InvoiceWhereInput = {
      id,
      status: { in: ISSUABLE_FROM as Prisma.EnumInvoiceStatusFilter["in"] },
      ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}),
    };
    const result = await prisma.invoice.updateMany({ where, data: { status: "ISSUED" } });
    if (result.count === 0) {
      throw new ConflictError(`Invoice cannot be issued from status ${existing.status}, or it was changed by someone else. Reload and try again.`);
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_ISSUED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ISSUED", total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getInvoice(organizationId, id);
  },

  async voidInvoice(caller: SanitizedUser, id: string, input: VoidInvoiceInput, meta: RequestMeta = {}): Promise<InvoiceWithEffectiveStatus> {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status === "VOID" || existing.status === "CANCELLED" || existing.status === "PAID") {
      throw new ConflictError(`An invoice with status ${existing.status} cannot be voided.`);
    }
    if (isPositive(existing.amountPaid)) {
      throw new ConflictError("This invoice has completed payments — reverse them before voiding the invoice.");
    }

    const targetStatus = existing.status === "DRAFT" ? "CANCELLED" : "VOID";
    const count = await invoiceRepository.transitionStatus(id, [existing.status], { status: targetStatus, voidReason: input.reason });
    if (count === 0) throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: targetStatus === "VOID" ? "INVOICE_VOIDED" : "INVOICE_CANCELLED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: targetStatus, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getInvoice(organizationId, id);
  },

  async recordPayment(caller: SanitizedUser, invoiceId: string, input: RecordPaymentInput, meta: RequestMeta = {}): Promise<Payment> {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(invoiceId, organizationId);

    const amount = toMoney(input.amount);
    if (!isPositive(amount)) throw new ValidationError("Payment amount must be positive.");
    const currency = input.currency ?? existing.currency;
    assertSameCurrency(currency, existing.currency, "the payment and the invoice");

    const payment = await prisma.$transaction(async (tx) => {
      await invoiceRepository.lockForPayment(tx, invoiceId);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!PAYABLE_STATUSES.includes(fresh.status)) {
        throw new ConflictError(`Payments can only be recorded against an issued invoice (current status: ${fresh.status}).`);
      }

      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, invoiceId);
      const before = calculateInvoiceBalance(fresh.total, completedAmounts);
      if (amount.greaterThan(before.amountDue)) {
        // Never silently caps an overpayment (§21) — reject it outright.
        throw new ValidationError(`Payment amount (${amount.toString()}) exceeds the outstanding balance of ${before.amountDue.toString()}.`);
      }

      const created = await paymentRepository.create(tx, {
        invoiceId,
        organizationId,
        amount,
        currency,
        paymentDate: input.paymentDate,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        createdById: caller.id,
      });

      const after = calculateInvoiceBalance(fresh.total, [...completedAmounts, amount]);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: after.amountPaid, amountDue: after.amountDue, status: statusForBalance(after.amountPaid, after.amountDue) },
      });

      return created;
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_RECORDED",
      resourceType: "payment",
      resourceId: payment.id,
      afterData: { invoiceId, amount: amount.toString(), currency, method: input.method },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return payment;
  },
};
