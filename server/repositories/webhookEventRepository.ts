import type { WebhookEventStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

export const webhookEventRepository = {
  /**
   * Records an inbound webhook delivery. Returns `{ duplicate: true }`
   * instead of throwing if (provider, deliveryId) was already recorded —
   * this is the idempotency/replay guard required by Phase 1 §20 and
   * docs/SECURITY_MODEL.md.
   */
  async recordDelivery(entry: {
    provider: string;
    deliveryId: string;
    eventType: string;
    signatureValid: boolean;
    status: WebhookEventStatus;
    payload: unknown;
    organizationId?: string;
  }): Promise<{ duplicate: boolean }> {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: entry.provider,
          deliveryId: entry.deliveryId,
          eventType: entry.eventType,
          signatureValid: entry.signatureValid,
          status: entry.status,
          payload: entry.payload as Prisma.InputJsonValue,
          organizationId: entry.organizationId,
        },
      });
      return { duplicate: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return { duplicate: true };
      }
      throw err;
    }
  },

  async findByDeliveryId(provider: string, deliveryId: string) {
    return prisma.webhookEvent.findUnique({
      where: { provider_deliveryId: { provider, deliveryId } },
    });
  },
};
