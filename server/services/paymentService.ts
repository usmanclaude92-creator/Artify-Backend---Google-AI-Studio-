/**
 * Payment list + reversal (Phase 10 — docs/BILLING_ARCHITECTURE.md).
 * Recording a payment lives in invoiceService.recordPayment (mounted at
 * POST /invoices/:id/payments) since it is inseparable from validating and
 * locking the parent invoice. Reversal never deletes the row or changes
 * its amount/date/method — it only ever sets the reversal fields
 * (reversedAt/reversedById/reversalReason), and a REVERSED payment stops
 * counting toward the invoice's amountPaid (§17/§50).
 */
import { paymentRepository, type PaymentFilters } from "../repositories/paymentRepository";
import { invoiceRepository } from "../repositories/invoiceRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { calculateInvoiceBalance } from "./billingCalculations";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { ReversePaymentInput } from "../schemas/paymentSchemas";
import type { RequestMeta } from "./authService";
import type { Payment } from "@prisma/client";

function statusForBalance(amountPaid: { isZero: () => boolean }, amountDue: { isZero: () => boolean }): "ISSUED" | "PARTIALLY_PAID" | "PAID" {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}

async function loadPaymentOrThrow(id: string, organizationId: string): Promise<Payment> {
  const payment = await paymentRepository.findByIdInOrg(id, organizationId);
  if (!payment) throw new NotFoundError("Payment not found.");
  return payment;
}

export const paymentService = {
  async listPayments(organizationId: string, filters: PaymentFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return paymentRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getPayment(organizationId: string, id: string): Promise<Payment> {
    return loadPaymentOrThrow(id, organizationId);
  },

  async reversePayment(caller: SanitizedUser, id: string, input: ReversePaymentInput, meta: RequestMeta = {}): Promise<Payment> {
    const organizationId = caller.organizationId;
    const existing = await loadPaymentOrThrow(id, organizationId);
    if (existing.status !== "COMPLETED") {
      throw new ConflictError(`Only a COMPLETED payment can be reversed (current status: ${existing.status}).`);
    }

    const reversedAt = new Date();
    await prisma.$transaction(async (tx) => {
      // Locks the parent Invoice first (§37) — the same serialization point
      // invoiceService.recordPayment uses — so a reversal can never race a
      // concurrent payment recording against the same invoice.
      await invoiceRepository.lockForPayment(tx, existing.invoiceId);

      const result = await tx.payment.updateMany({
        where: { id, status: "COMPLETED" },
        data: { status: "REVERSED", reversalReason: input.reason, reversedById: caller.id, reversedAt },
      });
      if (result.count === 0) throw new ConflictError("This payment was already reversed by someone else.");

      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: existing.invoiceId } });
      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, existing.invoiceId);
      const balance = calculateInvoiceBalance(invoice.total, completedAmounts);
      await tx.invoice.update({
        where: { id: existing.invoiceId },
        data: { amountPaid: balance.amountPaid, amountDue: balance.amountDue, status: statusForBalance(balance.amountPaid, balance.amountDue) },
      });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_REVERSED",
      resourceType: "payment",
      resourceId: id,
      beforeData: { status: "COMPLETED", amount: existing.amount.toString() },
      afterData: { status: "REVERSED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadPaymentOrThrow(id, organizationId);
  },
};
