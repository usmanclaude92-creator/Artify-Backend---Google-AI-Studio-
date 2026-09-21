/**
 * Invoice + InvoiceItem data access (Phase 10 —
 * docs/BILLING_ARCHITECTURE.md). Same organization-scoped-lookup-only
 * convention as every tenant-owned repository since Phase 5. Never
 * soft-deleted — immutable once ISSUED, void/cancel via `status`.
 */
import type { Invoice, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const withItemsAndPayments = { include: { items: true, payments: { orderBy: { createdAt: "asc" as const } } } };
export type InvoiceWithDetails = Prisma.InvoiceGetPayload<typeof withItemsAndPayments>;

export interface InvoiceFilters {
  search?: string;
  status?: string;
  clientId?: string;
  contractId?: string;
  subscriptionId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function buildWhere(organizationId: string, filters: InvoiceFilters): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumInvoiceStatusFilter["equals"];
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.contractId) where.contractId = filters.contractId;
  if (filters.subscriptionId) where.subscriptionId = filters.subscriptionId;
  if (filters.dateFrom || filters.dateTo) {
    where.issueDate = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.search) where.invoiceNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}

export const invoiceRepository = {
  async list(organizationId: string, filters: InvoiceFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.invoice.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<InvoiceWithDetails | null> {
    return prisma.invoice.findFirst({ where: { id, organizationId }, ...withItemsAndPayments });
  },

  async listForClientInOrg(clientId: string, organizationId: string): Promise<Invoice[]> {
    return prisma.invoice.findMany({ where: { clientId, organizationId }, orderBy: { issueDate: "desc" } });
  },

  async create(
    data: {
      invoiceNumber: string;
      organizationId: string;
      clientId: string;
      contractId?: string;
      subscriptionId?: string;
      issueDate: Date;
      dueDate: Date;
      currency: string;
      subtotal: Prisma.Decimal;
      tax: Prisma.Decimal;
      discount: Prisma.Decimal;
      total: Prisma.Decimal;
      amountDue: Prisma.Decimal;
      notes?: string;
      createdById: string;
    },
    items: { productModuleId?: string; description: string; quantity: number; unitPrice: Prisma.Decimal; discount: Prisma.Decimal; lineTotal: Prisma.Decimal }[]
  ): Promise<InvoiceWithDetails> {
    return prisma.invoice.create({
      data: { ...data, items: { create: items } },
      ...withItemsAndPayments,
    });
  },

  async update(id: string, data: Prisma.InvoiceUpdateInput): Promise<Invoice> {
    return prisma.invoice.update({ where: { id }, data });
  },

  async replaceItems(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    items: { productModuleId?: string; description: string; quantity: number; unitPrice: Prisma.Decimal; discount: Prisma.Decimal; lineTotal: Prisma.Decimal }[]
  ): Promise<void> {
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoiceItem.createMany({ data: items.map((item) => ({ ...item, invoiceId })) });
  },

  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id: string, fromStatuses: string[], data: Prisma.InvoiceUpdateManyMutationInput): Promise<number> {
    const result = await prisma.invoice.updateMany({
      where: { id, status: { in: fromStatuses as Prisma.EnumInvoiceStatusFilter["in"] } },
      data,
    });
    return result.count;
  },

  /** Serializes concurrent payment record/reversal against the same invoice — required because those operations read a computed sum (Σ completed payments) and validate against it before writing, which a plain conditional updateMany cannot express (§37). */
  async lockForPayment(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
  },

  async completedPaymentAmounts(tx: Prisma.TransactionClient, invoiceId: string): Promise<Prisma.Decimal[]> {
    const rows = await tx.payment.findMany({ where: { invoiceId, status: "COMPLETED" }, select: { amount: true } });
    return rows.map((r) => r.amount);
  },
};
