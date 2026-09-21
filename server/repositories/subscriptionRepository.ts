/**
 * Subscription + SubscriptionItem data access (Phase 10 —
 * docs/BILLING_ARCHITECTURE.md). Same organization-scoped-lookup-only
 * convention as every tenant-owned repository since Phase 5. Never
 * soft-deleted — lifecycle is tracked purely via `status`.
 */
import type { Subscription, SubscriptionItem, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const withItems = { include: { items: true } };
export type SubscriptionWithItems = Prisma.SubscriptionGetPayload<typeof withItems>;

export interface SubscriptionFilters {
  search?: string;
  status?: string;
  clientId?: string;
  productId?: string;
}

function buildWhere(organizationId: string, filters: SubscriptionFilters): Prisma.SubscriptionWhereInput {
  const where: Prisma.SubscriptionWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumSubscriptionStatusFilter["equals"];
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.productId) where.productId = filters.productId;
  if (filters.search) where.subscriptionNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}

export const subscriptionRepository = {
  async list(organizationId: string, filters: SubscriptionFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.subscription.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.subscription.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<SubscriptionWithItems | null> {
    return prisma.subscription.findFirst({ where: { id, organizationId }, ...withItems });
  },

  async listForClientInOrg(clientId: string, organizationId: string): Promise<Subscription[]> {
    return prisma.subscription.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },

  async create(
    data: {
      subscriptionNumber: string;
      organizationId: string;
      clientId: string;
      productId: string;
      startDate: Date;
      billingCycle: string;
      quantity: number;
      price: Prisma.Decimal;
      currency: string;
      createdById: string;
    },
    items: { productModuleId?: string; description: string; quantity: number; unitPrice: Prisma.Decimal; currency: string }[]
  ): Promise<SubscriptionWithItems> {
    return prisma.subscription.create({
      data: {
        subscriptionNumber: data.subscriptionNumber,
        organizationId: data.organizationId,
        clientId: data.clientId,
        productId: data.productId,
        startDate: data.startDate,
        billingCycle: data.billingCycle as Subscription["billingCycle"],
        quantity: data.quantity,
        price: data.price,
        currency: data.currency,
        createdById: data.createdById,
        items: { create: items },
      },
      ...withItems,
    });
  },

  async update(id: string, data: Prisma.SubscriptionUpdateInput): Promise<Subscription> {
    return prisma.subscription.update({ where: { id }, data });
  },

  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id: string, fromStatuses: string[], data: Prisma.SubscriptionUncheckedUpdateManyInput): Promise<number> {
    const result = await prisma.subscription.updateMany({
      where: { id, status: { in: fromStatuses as Prisma.EnumSubscriptionStatusFilter["in"] } },
      data,
    });
    return result.count;
  },
};

export type { SubscriptionItem };
