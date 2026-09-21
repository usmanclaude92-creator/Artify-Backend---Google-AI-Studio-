/**
 * Subscription lifecycle (Phase 10 — docs/BILLING_ARCHITECTURE.md).
 * Organization-scoped. Status is server-controlled only — activate/pause/
 * cancel each have their own dedicated, permission-gated endpoint; the
 * generic PATCH can never touch status. `price`/item `unitPrice` are this
 * subscription's own snapshot at creation time (Product/ProductModule have
 * no shared price list to snapshot from — see schema.prisma's Subscription
 * doc comment), so a later product change never rewrites an existing
 * subscription.
 */
import { subscriptionRepository, type SubscriptionFilters, type SubscriptionWithItems } from "../repositories/subscriptionRepository";
import { clientRepository } from "../repositories/clientRepository";
import { productRepository } from "../repositories/productRepository";
import { productModuleRepository } from "../repositories/productModuleRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { toMoney, DEFAULT_CURRENCY } from "../utils/money";
import { nextSubscriptionNumber } from "../utils/sequence";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CancelSubscriptionInput, CreateSubscriptionInput, UpdateSubscriptionInput } from "../schemas/subscriptionSchemas";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

const ACTIVATABLE_FROM = ["DRAFT", "TRIALING", "PAUSED"];
const PAUSABLE_FROM = ["ACTIVE", "PAST_DUE"];
const CANCELLABLE_FROM = ["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"];

async function loadSubscriptionOrThrow(id: string, organizationId: string): Promise<SubscriptionWithItems> {
  const subscription = await subscriptionRepository.findByIdInOrg(id, organizationId);
  if (!subscription) throw new NotFoundError("Subscription not found.");
  return subscription;
}

export const subscriptionService = {
  async listSubscriptions(organizationId: string, filters: SubscriptionFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return subscriptionRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getSubscription(organizationId: string, id: string): Promise<SubscriptionWithItems> {
    return loadSubscriptionOrThrow(id, organizationId);
  },

  async createSubscription(caller: SanitizedUser, input: CreateSubscriptionInput, meta: RequestMeta = {}): Promise<SubscriptionWithItems> {
    const organizationId = caller.organizationId;

    const client = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client) throw new ValidationError("The specified client does not exist in this organization.");

    const product = await productRepository.findById(input.productId);
    if (!product) throw new ValidationError("The specified product does not exist.");

    const currency = input.currency ?? DEFAULT_CURRENCY;

    for (const item of input.items) {
      if (item.productModuleId) {
        const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, input.productId);
        if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the selected product.`);
      }
    }

    const subscriptionNumber = await nextSubscriptionNumber();
    const subscription = await subscriptionRepository.create(
      {
        subscriptionNumber,
        organizationId,
        clientId: input.clientId,
        productId: input.productId,
        startDate: input.startDate,
        billingCycle: input.billingCycle,
        quantity: input.quantity,
        price: toMoney(input.price),
        currency,
        createdById: caller.id,
      },
      input.items.map((item) => ({
        productModuleId: item.productModuleId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: toMoney(item.unitPrice),
        currency,
      }))
    );

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CREATED",
      resourceType: "subscription",
      resourceId: subscription.id,
      afterData: { subscriptionNumber, clientId: input.clientId, productId: input.productId, price: subscription.price.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return subscription;
  },

  async updateSubscription(caller: SanitizedUser, id: string, input: UpdateSubscriptionInput, meta: RequestMeta = {}): Promise<SubscriptionWithItems> {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} subscription can no longer be edited.`);
    }

    const patch: Record<string, unknown> = {};
    if (input.renewalDate !== undefined) patch.renewalDate = input.renewalDate;
    if (input.endDate !== undefined) patch.endDate = input.endDate;
    if (input.quantity !== undefined) patch.quantity = input.quantity;
    if (input.price !== undefined) patch.price = toMoney(input.price);

    const where: Prisma.SubscriptionWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
    const result = await prisma.subscription.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This subscription was changed by someone else since you loaded it. Reload and try again.");
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_UPDATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { quantity: existing.quantity, price: existing.price.toString() },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadSubscriptionOrThrow(id, organizationId);
  },

  async activateSubscription(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<SubscriptionWithItems> {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, ACTIVATABLE_FROM, { status: "ACTIVE" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to ACTIVE.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_ACTIVATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadSubscriptionOrThrow(id, organizationId);
  },

  async pauseSubscription(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<SubscriptionWithItems> {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, PAUSABLE_FROM, { status: "PAUSED" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to PAUSED.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_PAUSED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PAUSED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadSubscriptionOrThrow(id, organizationId);
  },

  async cancelSubscription(caller: SanitizedUser, id: string, input: CancelSubscriptionInput, meta: RequestMeta = {}): Promise<SubscriptionWithItems> {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const now = new Date();
    const count = await subscriptionRepository.transitionStatus(id, CANCELLABLE_FROM, {
      status: "CANCELLED",
      cancelledAt: now,
      cancellationReason: input.reason,
      cancelledById: caller.id,
    });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to CANCELLED.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CANCELLED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "CANCELLED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return loadSubscriptionOrThrow(id, organizationId);
  },
};
