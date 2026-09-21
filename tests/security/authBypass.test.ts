/**
 * Phase 3 §27 "security regression" — proves authentication/authorization
 * cannot be bypassed by tampering with the request rather than exploiting
 * a logic gap. Complements tests/security/authz.test.ts (middleware
 * foundation) and tests/security/rbacAndAudit.test.ts (data-layer RBAC).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { hashToken } from "../../server/utils/crypto";
import { resetDb } from "../helpers/db";

describe("authentication/authorization cannot be bypassed by request tampering", () => {
  const app = createApp();
  finalizeApp(app);

  let orgAToken: string;
  let orgAAdminId: string;
  let orgBId: string;

  beforeAll(async () => {
    await resetDb();

    const a = await request(app).post("/api/v1/auth/register").send({
      email: "bypass-org-a@example.com",
      password: "OriginalPassword123",
      firstName: "Org",
      lastName: "A",
      organizationName: "Bypass Org A",
    });
    orgAToken = a.body.data.session.token;
    orgAAdminId = a.body.data.user.id;

    const b = await request(app).post("/api/v1/auth/register").send({
      email: "bypass-org-b@example.com",
      password: "OriginalPassword123",
      firstName: "Org",
      lastName: "B",
      organizationName: "Bypass Org B",
    });
    orgBId = b.body.data.user.organizationId;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("a modified organizationId in the request BODY cannot redirect a create to another tenant", async () => {
    // POST /api/v1/users never reads organizationId from the body at all —
    // it is always the caller's own session organization (server/services/userService.ts).
    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({
        email: "smuggled-org@example.com",
        password: "SomePassword123",
        firstName: "S",
        lastName: "O",
        roleKey: "VIEWER",
        organizationId: orgBId, // attempted smuggling — must be ignored
      });
    expect(res.status).toBe(201);

    const created = await prisma.user.findUniqueOrThrow({ where: { email: "smuggled-org@example.com" } });
    expect(created.organizationId).not.toBe(orgBId);
  });

  it("a modified :id path param to another tenant's organization is rejected on membership routes", async () => {
    const res = await request(app)
      .post(`/api/v1/organizations/${orgBId}/members`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({ userId: orgAAdminId, roleKey: "VIEWER" });
    expect(res.status).toBe(403);
  });

  it("a modified user id in a PATCH body/path cannot be used to escalate the caller's own role", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${orgAAdminId}`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({ id: "ignored-should-not-matter", roleKey: "VIEWER" });
    expect(res.status).toBe(403); // self-role-change is blocked regardless of what the body claims
  });

  it("a bit-flipped (tampered) session token is rejected, not silently accepted", async () => {
    const tampered = orgAToken.slice(0, -4) + "0000";
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it("a malformed Authorization header (no Bearer prefix, empty, wrong scheme) is rejected", async () => {
    const noPrefix = await request(app).get("/api/v1/auth/me").set("Authorization", orgAToken);
    const empty = await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer ");
    const basicScheme = await request(app).get("/api/v1/auth/me").set("Authorization", `Basic ${orgAToken}`);
    expect(noPrefix.status).toBe(401);
    expect(empty.status).toBe(401);
    expect(basicScheme.status).toBe(401);
  });

  it("an expired session is rejected even though the token itself is well-formed", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "bypass-org-a@example.com" } });
    const expiredToken = "art_sess_expired_regression_test_token_0000000000000000000000";
    await prisma.session.create({
      data: {
        tokenHash: hashToken(expiredToken),
        userId: user.id,
        organizationId: user.organizationId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });

  it("an unauthenticated request to every privileged Phase 3 route is rejected with 401, never a silent 200", async () => {
    const results = await Promise.all([
      request(app).get("/api/v1/users"),
      request(app).post("/api/v1/users"),
      request(app).patch(`/api/v1/users/${orgAAdminId}`),
      request(app).get("/api/v1/roles"),
      request(app).get("/api/v1/permissions"),
      request(app).get("/api/v1/organizations"),
      request(app).post(`/api/v1/organizations/${orgBId}/members`),
      request(app).post("/api/v1/auth/logout-all"),
      request(app).post("/api/v1/auth/change-password"),
      request(app).post("/api/v1/auth/switch-organization"),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
    }
  });
});
