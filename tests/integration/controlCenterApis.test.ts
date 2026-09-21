/**
 * Phase 4 — Control Center backend additions: audit-log listing,
 * self-service session listing/revocation, organization member listing +
 * summary, and settings foundation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("GET /api/v1/audit-logs", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "audit-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Audit",
      lastName: "Admin",
      organizationName: "Audit Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    const viewer = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "audit-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "audit-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
    void viewer;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/audit-logs");
    expect(res.status).toBe(401);
  });

  it("VIEWER has audit.read and can list, scoped to their own organization", async () => {
    const res = await request(app).get("/api/v1/audit-logs").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.auditLogs.length).toBeGreaterThan(0);
    expect(res.body.data.auditLogs.every((a: { organizationId: string }) => a.organizationId === orgId)).toBe(true);
    expect(res.body.meta.pagination.total).toBeGreaterThan(0);
  });

  it("is immutable — no PATCH/PUT/DELETE route exists on this path", async () => {
    const results = await Promise.all([
      request(app).patch("/api/v1/audit-logs/1").set("Authorization", `Bearer ${adminToken}`).send({}),
      request(app).delete("/api/v1/audit-logs/1").set("Authorization", `Bearer ${adminToken}`),
    ]);
    for (const res of results) {
      expect(res.status).toBe(404);
    }
  });

  it("filters by action", async () => {
    const res = await request(app)
      .get("/api/v1/audit-logs")
      .query({ action: "USER_CREATED" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.auditLogs.every((a: { action: string }) => a.action === "USER_CREATED")).toBe(true);
  });

  it("a user in a different organization never sees this organization's audit entries", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({
      email: "audit-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Audit Co",
    });
    const res = await request(app).get("/api/v1/audit-logs").set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.auditLogs.some((a: { organizationId: string }) => a.organizationId === orgId)).toBe(false);
  });
});

describe("session self-service (GET/POST /api/v1/auth/sessions)", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("lists the caller's own active sessions, marks the current one, and never exposes a token hash", async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "session-list@example.com",
      password: "OriginalPassword123",
      firstName: "S",
      lastName: "L",
      organizationName: "Session List Co",
    });
    const tokenA = reg.body.data.session.token;
    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "session-list@example.com", password: "OriginalPassword123" });
    const tokenB = loginB.body.data.session.token;

    const res = await request(app).get("/api/v1/auth/sessions").set("Authorization", `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|token_hash/i);
    const current = res.body.data.sessions.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(current).toBeDefined();

    const resB = await request(app).get("/api/v1/auth/sessions").set("Authorization", `Bearer ${tokenB}`);
    const currentB = resB.body.data.sessions.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(currentB.id).not.toBe(current.id);
  });

  it("revokes only the caller's own session; a foreign session id is rejected (404, not leaked)", async () => {
    const userA = await request(app).post("/api/v1/auth/register").send({
      email: "revoke-a@example.com",
      password: "OriginalPassword123",
      firstName: "A",
      lastName: "A",
      organizationName: "Revoke A Co",
    });
    const userB = await request(app).post("/api/v1/auth/register").send({
      email: "revoke-b@example.com",
      password: "OriginalPassword123",
      firstName: "B",
      lastName: "B",
      organizationName: "Revoke B Co",
    });
    const listB = await request(app).get("/api/v1/auth/sessions").set("Authorization", `Bearer ${userB.body.data.session.token}`);
    const sessionBId = listB.body.data.sessions[0].id;

    const crossRevoke = await request(app)
      .post(`/api/v1/auth/sessions/${sessionBId}/revoke`)
      .set("Authorization", `Bearer ${userA.body.data.session.token}`);
    expect(crossRevoke.status).toBe(404);

    // B's session still works.
    const meB = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${userB.body.data.session.token}`);
    expect(meB.status).toBe(200);

    const listA = await request(app).get("/api/v1/auth/sessions").set("Authorization", `Bearer ${userA.body.data.session.token}`);
    const sessionAId = listA.body.data.sessions[0].id;
    const ownRevoke = await request(app)
      .post(`/api/v1/auth/sessions/${sessionAId}/revoke`)
      .set("Authorization", `Bearer ${userA.body.data.session.token}`);
    expect(ownRevoke.status).toBe(200);

    const meA = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${userA.body.data.session.token}`);
    expect(meA.status).toBe(401);
  });
});

describe("organization members list + summary", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("lists members with real data, paginated; blocks cross-tenant access", async () => {
    await resetDb();
    const admin = await request(app).post("/api/v1/auth/register").send({
      email: "members-admin@example.com",
      password: "OriginalPassword123",
      firstName: "M",
      lastName: "A",
      organizationName: "Members Co",
    });
    const orgId = admin.body.data.user.organizationId;
    const token = admin.body.data.session.token;

    const listRes = await request(app).get(`/api/v1/organizations/${orgId}/members`).set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.members).toHaveLength(1);
    expect(listRes.body.data.members[0].email).toBe("members-admin@example.com");
    expect(listRes.body.meta.pagination.total).toBe(1);

    const summaryRes = await request(app).get(`/api/v1/organizations/${orgId}/summary`).set("Authorization", `Bearer ${token}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data.memberCount).toBe(1);
    expect(summaryRes.body.data.activeSessionCount).toBeGreaterThanOrEqual(1);

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "members-other@example.com",
      password: "OriginalPassword123",
      firstName: "O",
      lastName: "O",
      organizationName: "Other Members Co",
    });
    const crossList = await request(app)
      .get(`/api/v1/organizations/${orgId}/members`)
      .set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(crossList.status).toBe(403);
  });
});

describe("settings foundation", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("upserts and lists a setting scoped to the caller's organization, audited", async () => {
    await resetDb();
    const admin = await request(app).post("/api/v1/auth/register").send({
      email: "settings-admin@example.com",
      password: "OriginalPassword123",
      firstName: "S",
      lastName: "A",
      organizationName: "Settings Co",
    });
    const token = admin.body.data.session.token;
    const orgId = admin.body.data.user.organizationId;

    const patchRes = await request(app)
      .patch("/api/v1/settings/branding.display_name")
      .set("Authorization", `Bearer ${token}`)
      .send({ value: "Settings Co", type: "STRING" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.setting.key).toBe("branding.display_name");

    const listRes = await request(app).get("/api/v1/settings").set("Authorization", `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.settings).toHaveLength(1);

    const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: orgId, action: "SETTINGS_UPDATED" } });
    expect(auditRow).not.toBeNull();
  });

  it("a VIEWER (settings.read only) cannot update a setting", async () => {
    const admin = await request(app).post("/api/v1/auth/register").send({
      email: "settings-admin-2@example.com",
      password: "OriginalPassword123",
      firstName: "S",
      lastName: "A",
      organizationName: "Settings Co 2",
    });
    const viewer = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${admin.body.data.session.token}`)
      .send({ email: "settings-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    void viewer;
    const viewerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "settings-viewer@example.com", password: "ViewerPassword123" });

    const res = await request(app)
      .patch("/api/v1/settings/branding.display_name")
      .set("Authorization", `Bearer ${viewerLogin.body.data.session.token}`)
      .send({ value: "Hacked", type: "STRING" });
    expect(res.status).toBe(403);
  });
});
