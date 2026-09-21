/**
 * Regression suite for Phase 0 CRITICAL finding S3/R3: the old
 * artify-backend/server.ts webhook check defaulted `isVerified = true` and
 * only rejected a request that supplied an explicitly wrong signature — a
 * request with NO signature header was accepted. Every case below proves
 * that inversion cannot recur (server/services/webhookService.ts).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";

const SIGNATURE_HEADER = "x-artify-webhook-signature";
const TIMESTAMP_HEADER = "x-artify-webhook-timestamp";

function sign(secret: string, timestamp: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function validPayload(deliveryId: string) {
  return {
    deliveryId,
    eventType: "lead.created",
    name: "Jane Prospect",
    email: "jane@prospect.example.com",
    companyName: "Prospect Co",
    projectBrief: "We need an AI agent fleet.",
    source: "contact_form",
  };
}

describe("webhook signature verification (security regression suite)", () => {
  const app = createApp();
  finalizeApp(app);

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  it("ACCEPTS a request with a valid signature and current timestamp", async () => {
    const body = validPayload("evt_valid_001");
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(config.webhookSecret, ts, raw);

    const res = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, sig)
      .set(TIMESTAMP_HEADER, ts)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(true);
    expect(res.body.data.duplicate).toBe(false);
  });

  it("REJECTS a request with NO signature header at all — the exact Phase 0 vulnerability", async () => {
    const body = validPayload("evt_missing_sig_001");

    const res = await request(app).post("/api/v1/webhooks/leads").send(body);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("REJECTS a request with a present but wrong signature", async () => {
    const body = validPayload("evt_wrong_sig_001");
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();

    const res = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, "0".repeat(64))
      .set(TIMESTAMP_HEADER, ts)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(401);
  });

  it("REJECTS a tampered payload (valid signature for a different body)", async () => {
    const originalBody = validPayload("evt_tampered_001");
    const raw = JSON.stringify(originalBody);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(config.webhookSecret, ts, raw); // signed over the ORIGINAL body

    const tamperedBody = { ...originalBody, projectBrief: "ATTACKER CHANGED THIS FIELD" };

    const res = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, sig)
      .set(TIMESTAMP_HEADER, ts)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(tamperedBody));

    expect(res.status).toBe(401);
  });

  it("REJECTS an expired timestamp (replay protection)", async () => {
    const body = validPayload("evt_replay_001");
    const raw = JSON.stringify(body);
    const oldTs = (Math.floor(Date.now() / 1000) - 20 * 60).toString(); // 20 minutes old
    const sig = sign(config.webhookSecret, oldTs, raw);

    const res = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, sig)
      .set(TIMESTAMP_HEADER, oldTs)
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it("treats a second delivery of the same (provider, deliveryId) as an idempotent duplicate, not an error", async () => {
    const body = validPayload("evt_duplicate_001");
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = sign(config.webhookSecret, ts, raw);

    const first = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, sig)
      .set(TIMESTAMP_HEADER, ts)
      .set("Content-Type", "application/json")
      .send(raw);
    expect(first.status).toBe(200);
    expect(first.body.data.duplicate).toBe(false);

    const second = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, sig)
      .set(TIMESTAMP_HEADER, ts)
      .set("Content-Type", "application/json")
      .send(raw);
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
  });

  it("REJECTS a malformed (non-numeric) timestamp", async () => {
    const body = validPayload("evt_bad_ts_001");
    const raw = JSON.stringify(body);

    const res = await request(app)
      .post("/api/v1/webhooks/leads")
      .set(SIGNATURE_HEADER, "a".repeat(64))
      .set(TIMESTAMP_HEADER, "not-a-timestamp")
      .set("Content-Type", "application/json")
      .send(raw);

    expect(res.status).toBe(401);
  });
});
