/**
 * Payment data access (Phase 10 — docs/BILLING_ARCHITECTURE.md). Same
 * organization-scoped-lookup-only convention as every tenant-owned
 * repository since Phase 5. Never deleted — correction is via reversal
 * (fields on the same row), never a row delete (see Payment's schema doc
 * comment).
 */
import type { Payment, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface PaymentFilters {
  status?: string;
  method?: string;
  invoiceId?: string;
  clientId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function buildWhere(organizationId: string, filters: PaymentFilters): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumPaymentStatusFilter["equals"];
  if (filters.method) where.method = filters.method as Prisma.EnumPaymentMethodFilter["equals"];
  if (filters.invoiceId) where.invoiceId = filters.invoiceId;
  if (filters.clientId) where.invoice = { clientId: filters.clientId };
  if (filters.dateFrom || filters.dateTo) {
    where.paymentDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  return where;
}

export const paymentRepository = {
  async list(organizationId: string, filters: PaymentFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.payment.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Payment | null> {
    return prisma.payment.findFirst({ where: { id, organizationId } });
  },

  async listForInvoiceInOrg(invoiceId: string, organizationId: string): Promise<Payment[]> {
    return prisma.payment.findMany({ where: { invoiceId, organizationId }, orderBy: { createdAt: "asc" } });
  },

  async create(
    tx: Prisma.TransactionClient,
    data: {
      invoiceId: string;
      organizationId: string;
      amount: Prisma.Decimal;
      currency: string;
      paymentDate: Date;
      method: string;
      reference?: string;
      notes?: string;
      createdById: string;
    }
  ): Promise<Payment> {
    return tx.payment.create({
      data: {
        invoiceId: data.invoiceId,
        organizationId: data.organizationId,
        amount: data.amount,
        currency: data.currency,
        paymentDate: data.paymentDate,
        method: data.method as Payment["method"],
        reference: data.reference,
        notes: data.notes,
        createdById: data.createdById,
        status: "COMPLETED",
      },
    });
  },

  /** Race-safe conditional reversal — only a COMPLETED payment can be reversed, and the invoice row must already be locked (FOR UPDATE) by the caller within the same transaction (§37). */
  async reverse(tx: Prisma.TransactionClient, id: string, data: { reversalReason: string; reversedById: string; reversedAt: Date }): Promise<number> {
    const result = await tx.payment.updateMany({
      where: { id, status: "COMPLETED" },
      data: { status: "REVERSED", reversalReason: data.reversalReason, reversedById: data.reversedById, reversedAt: data.reversedAt },
    });
    return result.count;
  },
};
