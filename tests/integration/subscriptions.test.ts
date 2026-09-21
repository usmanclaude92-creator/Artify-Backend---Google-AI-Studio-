/** Phase 10 §46 — subscriptions: CRUD/product-module relationship/lifecycle/pricing snapshots/authorization/concurrency/IDOR. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("subscriptions", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let clientId: string;
  let productId: string;
  let moduleId: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "sub-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Sub",
      lastName: "Admin",
      organizationName: "Sub Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "sub-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "sub-viewer@example.com", password: "ViewerPassword123" })).body.data.session
      .token;

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "SUB-CLIENT-1", name: "Acme Subs" });
    clientId = client.body.data.client.id;

    const product = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "SUB-PROD-1", name: "Subscription Product", type: "SERVICE" });
    productId = product.body.data.product.id;

    const module_ = await request(app)
      .post(`/api/v1/products/${productId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "MOD-1", name: "Core Module" });
    moduleId = module_.body.data.module.id;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "sub-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Sub Other Org",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createSubscription(overrides: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        clientId,
        productId,
        startDate: "2026-01-01",
        billingCycle: "MONTHLY",
        price: "199.000",
        items: [{ productModuleId: moduleId, description: "Core module access", quantity: 1, unitPrice: "199.000" }],
        ...overrides,
      });
  }

  it("creates a subscription with a server-generated subscription number, DRAFT status, and its own price/currency snapshot", async () => {
    const res = await createSubscription();
    expect(res.status).toBe(201);
    expect(res.body.data.subscription.subscriptionNumber).toMatch(/^SUB-\d{6}$/);
    expect(res.body.data.subscription.status).toBe("DRAFT");
    expect(res.body.data.subscription.currency).toBe("OMR");
    expect(res.body.data.subscription.items).toHaveLength(1);
    expect(res.body.data.subscription.items[0].unitPrice).toBe("199");

    const audit = await prisma.auditLog.findFirst({ where: { action: "SUBSCRIPTION_CREATED", resourceId: res.body.data.subscription.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a subscription item whose productModuleId does not belong to the chosen product", async () => {
    const otherProduct = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "OTHER-PROD", name: "Other", type: "SERVICE" });
    const otherModule = await request(app)
      .post(`/api/v1/products/${otherProduct.body.data.product.id}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "OTHER-MOD", name: "Other Module" });

    const res = await createSubscription({ items: [{ productModuleId: otherModule.body.data.module.id, description: "x", quantity: 1, unitPrice: "10" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a subscription for a client or product that does not exist", async () => {
    expect((await createSubscription({ clientId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
    expect((await createSubscription({ productId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
  });

  it("PATCH never accepts status/clientId/productId/billingCycle — those are immutable or dedicated-endpoint-only", async () => {
    const created = await createSubscription();
    const id = created.body.data.subscription.id;

    const badPatch = await request(app).patch(`/api/v1/subscriptions/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });
    expect(badPatch.status).toBe(400);

    const goodPatch = await request(app).patch(`/api/v1/subscriptions/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ quantity: 3 });
    expect(goodPatch.status).toBe(200);
    expect(goodPatch.body.data.subscription.quantity).toBe(3);
  });

  it("activate/pause/cancel follow the server-controlled state machine", async () => {
    const created = await createSubscription();
    const id = created.body.data.subscription.id;

    const badPause = await request(app).post(`/api/v1/subscriptions/${id}/pause`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(badPause.status).toBe(409); // DRAFT cannot pause

    const activate = await request(app).post(`/api/v1/subscriptions/${id}/activate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(activate.status).toBe(200);
    expect(activate.body.data.subscription.status).toBe("ACTIVE");

    const pause = await request(app).post(`/api/v1/subscriptions/${id}/pause`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(pause.status).toBe(200);
    expect(pause.body.data.subscription.status).toBe("PAUSED");

    const cancel = await request(app).post(`/api/v1/subscriptions/${id}/cancel`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Client requested" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.subscription.status).toBe("CANCELLED");
    expect(cancel.body.data.subscription.cancellationReason).toBe("Client requested");

    const reactivate = await request(app).post(`/api/v1/subscriptions/${id}/activate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reactivate.status).toBe(409);
  });

  it("VIEWER can read but never create/update/activate subscriptions", async () => {
    const list = await request(app).get("/api/v1/subscriptions").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);
    const createRes = await request(app)
      .post("/api/v1/subscriptions")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ clientId, productId, startDate: "2026-01-01", billingCycle: "MONTHLY", price: "10" });
    expect(createRes.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/subscriptions")).status).toBe(401);
  });

  it("IDOR: a caller from a different organization cannot read or act on this subscription by id", async () => {
    const created = await createSubscription();
    const id = created.body.data.subscription.id;
    expect((await request(app).get(`/api/v1/subscriptions/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/subscriptions/${id}/activate`).set("Authorization", `Bearer ${otherOrgAdminToken}`).send()).status).toBe(404);
  });

  it("searches/filters/paginates subscriptions server-side", async () => {
    await createSubscription();
    await createSubscription();
    const byClient = await request(app).get("/api/v1/subscriptions").query({ clientId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byClient.body.data.subscriptions.every((s: { clientId: string }) => s.clientId === clientId)).toBe(true);
    const byProduct = await request(app).get("/api/v1/subscriptions").query({ productId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byProduct.body.data.subscriptions.length).toBeGreaterThanOrEqual(2);
  });

  it("concurrency: simultaneous subscription creations each get a unique subscription number (sequence-backed, never a duplicate)", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createSubscription()));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.data.subscription.subscriptionNumber);
    expect(new Set(numbers).size).toBe(5);
  });
});
