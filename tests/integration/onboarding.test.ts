/** Phase 6 §7-10 — onboarding lifecycle: start, step completion, invalid transitions, completion, cancellation, IDOR. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("client onboarding", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "onboarding-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Onboarding",
      lastName: "Admin",
      organizationName: "Onboarding Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "onboarding-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "onboarding-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createClient(name: string, clientCode: string) {
    const res = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode, name });
    return res.body.data.client.id as string;
  }

  it("starts onboarding for a client, initializing the full checklist NOT_STARTED->IN_PROGRESS, and audits CLIENT_ONBOARDING_STARTED", async () => {
    const clientId = await createClient("Onboard Me Co", "ONB-01");

    const res = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.onboarding.status).toBe("IN_PROGRESS");
    expect(res.body.data.onboarding.currentStep).toBe("CLIENT_VERIFIED");
    expect(res.body.data.onboarding.checklist).toHaveLength(7);
    expect(res.body.data.onboarding.checklist.every((c: { completed: boolean }) => c.completed === false)).toBe(true);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_STARTED", resourceId: res.body.data.onboarding.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects starting onboarding twice for the same client with 409", async () => {
    const clientId = await createClient("Double Start Co", "ONB-02");
    const first = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(second.status).toBe(409);

    const count = await prisma.clientOnboarding.count({ where: { clientId } });
    expect(count).toBe(1);
  });

  it("completes a checklist step via PATCH, advances currentStep, and flips to READY once all steps are done", async () => {
    const clientId = await createClient("Checklist Co", "ONB-03");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const steps = ["CLIENT_VERIFIED", "WORKSPACE_CREATED", "PRIMARY_CONTACT_CONFIRMED", "ADMINISTRATOR_INVITED", "ADMINISTRATOR_ACCEPTED", "WORKSPACE_CONFIGURED"];
    for (const step of steps) {
      const res = await request(app)
        .patch(`/api/v1/onboarding/${onboardingId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ completeStep: step });
      expect(res.status).toBe(200);
    }

    const last = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ completeStep: "ONBOARDING_COMPLETED" });
    expect(last.status).toBe(200);
    expect(last.body.data.onboarding.status).toBe("READY");
    expect(last.body.data.onboarding.currentStep).toBeNull();

    const audit = await prisma.auditLog.count({ where: { action: "ONBOARDING_STEP_COMPLETED", resourceId: onboardingId } });
    expect(audit).toBe(7);
  });

  it("rejects completeOnboarding before status is READY, and completes it once READY", async () => {
    const clientId = await createClient("Complete Flow Co", "ONB-04");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const tooEarly = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(tooEarly.status).toBe(400);

    const allSteps = [
      "CLIENT_VERIFIED",
      "WORKSPACE_CREATED",
      "PRIMARY_CONTACT_CONFIRMED",
      "ADMINISTRATOR_INVITED",
      "ADMINISTRATOR_ACCEPTED",
      "WORKSPACE_CONFIGURED",
      "ONBOARDING_COMPLETED",
    ];
    for (const step of allSteps) {
      await request(app).patch(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`).send({ completeStep: step });
    }

    const done = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(done.status).toBe(200);
    expect(done.body.data.onboarding.status).toBe("COMPLETED");
    expect(done.body.data.onboarding.completedAt).not.toBeNull();

    const auditEvent = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_COMPLETED", resourceId: onboardingId } });
    expect(auditEvent).not.toBeNull();

    // Once COMPLETED, no further step/status changes are accepted.
    const afterComplete = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CANCELLED" });
    expect(afterComplete.status).toBe(409);
  });

  it("cancels an in-progress onboarding and audits CLIENT_ONBOARDING_CANCELLED", async () => {
    const clientId = await createClient("Cancel Me Co", "ONB-05");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const res = await request(app).patch(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "CANCELLED" });
    expect(res.status).toBe(200);
    expect(res.body.data.onboarding.status).toBe("CANCELLED");

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ONBOARDING_CANCELLED", resourceId: onboardingId } });
    expect(audit).not.toBeNull();
  });

  it("rejects onboarding access/mutation by a caller without the right permission", async () => {
    const clientId = await createClient("Unauthorized Onboarding Co", "ONB-06");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const startRes = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${viewerToken}`).send({});
    expect(startRes.status).toBe(403);

    const patchRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ completeStep: "CLIENT_VERIFIED" });
    expect(patchRes.status).toBe(403);

    const completeRes = await request(app).post(`/api/v1/onboarding/${onboardingId}/complete`).set("Authorization", `Bearer ${viewerToken}`).send();
    expect(completeRes.status).toBe(403);
  });

  it("IDOR: another organization cannot read/update an onboarding record by guessing its id", async () => {
    const clientId = await createClient("IDOR Onboarding Co", "ONB-07");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "onboarding-idor-other@example.com",
      password: "OriginalPassword123",
      firstName: "I",
      lastName: "O",
      organizationName: "Onboarding IDOR Other Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/onboarding/${onboardingId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ completeStep: "CLIENT_VERIFIED" });
    expect(patchRes.status).toBe(404);

    // Cross-tenant onboarding-start for a client that isn't theirs, either.
    const crossStart = await request(app)
      .post(`/api/v1/clients/${clientId}/onboarding/start`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({});
    expect(crossStart.status).toBe(404);
  });

  it("lists onboarding records scoped to the caller's organization, filterable by status", async () => {
    const clientId = await createClient("Queue Co", "ONB-08");
    await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});

    const list = await request(app).get("/api/v1/onboarding").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.onboarding.length).toBeGreaterThan(0);

    const filtered = await request(app).get("/api/v1/onboarding").query({ status: "IN_PROGRESS" }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.onboarding.every((o: { status: string }) => o.status === "IN_PROGRESS")).toBe(true);
  });

  it("workspace provisioning automatically completes the WORKSPACE_CREATED checklist step on an in-progress onboarding", async () => {
    const clientId = await createClient("Auto Step Co", "ONB-09");
    const start = await request(app).post(`/api/v1/clients/${clientId}/onboarding/start`).set("Authorization", `Bearer ${adminToken}`).send({});
    const onboardingId = start.body.data.onboarding.id;

    await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});

    const reloaded = await request(app).get(`/api/v1/onboarding/${onboardingId}`).set("Authorization", `Bearer ${adminToken}`);
    const step = reloaded.body.data.onboarding.checklist.find((c: { key: string }) => c.key === "WORKSPACE_CREATED");
    expect(step.completed).toBe(true);
  });
});
