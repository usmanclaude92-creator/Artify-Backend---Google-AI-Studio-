/**
 * Webhook signature verification + idempotent recording.
 *
 * This directly fixes Phase 0 CRITICAL finding S3/R3
 * (artify-backend/server.ts:423-430): the old check set
 * `isVerified = true` by default and only flipped to `false` when a
 * signature header was present AND wrong — a request with NO signature
 * header was accepted. That inversion is now structurally impossible: a
 * missing header fails `verifyHmacSignature` (returns false for empty
 * input) before this service ever runs `next()`.
 *
 * Signature scheme: HMAC-SHA256 over `${timestamp}.${rawBody}`, hex-encoded,
 * constant-time compared (server/utils/crypto.ts). Binding the timestamp
 * into the signed payload (rather than signing the body alone) means an
 * attacker who captures one valid (signature, body) pair cannot replay it
 * indefinitely — it is bound to that specific timestamp and rejected once
 * outside the replay window below, and a second delivery of the exact same
 * event is separately rejected by the (provider, deliveryId) uniqueness
 * constraint (idempotency), not just the timestamp window.
 */
import { config } from "../config/env";
import { verifyHmacSignature } from "../utils/crypto";
import { webhookEventRepository } from "../repositories/webhookEventRepository";
import { AuthenticationError, ConflictError, ValidationError } from "../core/errors";
import { logger } from "../core/logger";
import type { LeadWebhookPayload } from "../schemas/webhookSchemas";

const REPLAY_WINDOW_SECONDS = 5 * 60;
const SIGNATURE_HEADER = "x-artify-webhook-signature";
const TIMESTAMP_HEADER = "x-artify-webhook-timestamp";

export interface WebhookVerificationInput {
  rawBody: Buffer | undefined;
  signatureHeader: string | string[] | undefined;
  timestampHeader: string | string[] | undefined;
}

export { SIGNATURE_HEADER, TIMESTAMP_HEADER };

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verifies signature + timestamp. Throws AuthenticationError for any
 * failure (missing header, malformed header, wrong signature, tampered
 * body, expired/future timestamp) — every failure mode maps to the same
 * rejection, deliberately, so a caller cannot probe which check failed.
 */
export function verifyWebhookSignature(input: WebhookVerificationInput): void {
  const signature = firstHeaderValue(input.signatureHeader);
  const timestampRaw = firstHeaderValue(input.timestampHeader);

  if (!signature || !timestampRaw || !input.rawBody) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const skewSeconds = Math.abs(nowSeconds - timestamp);
  if (skewSeconds > REPLAY_WINDOW_SECONDS) {
    throw new AuthenticationError("Webhook signature has expired.");
  }

  const signedPayload = Buffer.concat([Buffer.from(`${timestampRaw}.`), input.rawBody]);
  const valid = verifyHmacSignature(config.webhookSecret, signedPayload, signature);

  if (!valid) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
}

export const webhookService = {
  /**
   * Verifies the signature, then atomically records the delivery for
   * idempotency. Throws ConflictError on a duplicate delivery (same
   * provider + deliveryId already recorded) — the caller returns 200 for
   * duplicates per standard webhook convention (already-processed is not
   * an error to the sender), which the route handler decides, not this
   * service.
   */
  async ingestLeadEvent(
    payload: LeadWebhookPayload,
    verification: WebhookVerificationInput
  ): Promise<{ duplicate: boolean }> {
    verifyWebhookSignature(verification);

    const { duplicate } = await webhookEventRepository.recordDelivery({
      provider: "artify-website",
      deliveryId: payload.deliveryId,
      eventType: payload.eventType,
      signatureValid: true,
      status: "VERIFIED",
      payload,
    });

    if (duplicate) {
      logger.info({ event: "webhook_duplicate", deliveryId: payload.deliveryId }, "Duplicate webhook delivery ignored");
      return { duplicate: true };
    }

    logger.info({ event: "webhook_received", deliveryId: payload.deliveryId }, "Lead webhook verified and recorded");
    // Business processing (CRM auto-triage, lead scoring, notification
    // dispatch) is Phase 5 — see docs/IMPLEMENTATION_PLAN.md. Phase 1's
    // job is to prove the delivery is authentic and recorded exactly once.
    return { duplicate: false };
  },
};

// Re-export for tests that need to assert on the specific error types thrown.
export { ValidationError, ConflictError };
