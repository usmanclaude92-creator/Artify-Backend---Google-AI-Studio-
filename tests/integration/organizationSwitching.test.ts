/**
 * Phase 3 §18 — session-scoped role resolution and organization switching.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("organization switching", () => {
  const app = createApp();
  finalizeApp(app);

  let userToken: string;
  let userId: string;
  let homeOrgId: string;
  let secondOrgId: string;
  let thirdOrgId: string; // org the user is NOT a member of

  beforeAll(async () => {
    await resetDb();

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "switcher@example.com",
      password: "OriginalPassword123",
      firstName: "Switch",
      lastName: "User",
      organizationName: "Home Org",
    });
    userToken = reg.body.data.session.token;
    userId = reg.body.data.user.id;
    homeOrgId = reg.body.data.user.organizationId;

    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const secondOrg = await prisma.organization.create({ data: { name: "Second Org", slug: "second-org", status: "ACTIVE" } });
    secondOrgId = secondOrg.id;
    await prisma.organizationMembership.create({
      data: { userId, organizationId: secondOrgId, roleId: viewerRole.id, status: "ACTIVE", isPrimary: false },
    });

    const thirdOrg = await prisma.organization.create({ data: { name: "Third Org", slug: "third-org", status: "ACTIVE" } });
    thirdOrgId = thirdOrg.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET /auth/me lists every organization the user can switch into, with isCurrent set correctly", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    const orgIds = res.body.data.organizations.map((o: { organizationId: string }) => o.organizationId).sort();
    expect(orgIds).toEqual([homeOrgId, secondOrgId].sort());
    const current = res.body.data.organizations.find((o: { isCurrent: boolean }) => o.isCurrent);
    expect(current.organizationId).toBe(homeOrgId);
  });

  it("rejects switching to an organization the user is not a member of", async () => {
    const res = await request(app)
      .post("/api/v1/auth/switch-organization")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ organizationId: thirdOrgId });
    expect(res.status).toBe(403);
  });

  it("switches organization, recalculates the role/permissions for the new org, and rotates the session token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/switch-organization")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ organizationId: secondOrgId });

    expect(res.status).toBe(200);
    expect(res.body.data.user.organizationId).toBe(secondOrgId);
    expect(res.body.data.user.role.key).toBe("VIEWER");
    expect(res.body.data.user.role.permissions).not.toContain("users.create"); // VIEWER is read-only
    const newToken = res.body.data.session.token;
    expect(newToken).not.toBe(userToken);

    // Old (pre-switch) session token is now revoked.
    const oldSessionCheck = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${userToken}`);
    expect(oldSessionCheck.status).toBe(401);

    // New session token works and reflects the new org's role.
    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${newToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.organizationId).toBe(secondOrgId);
    expect(meRes.body.data.user.role.key).toBe("VIEWER");
  });

  it("a session stops working the instant its backing membership is revoked, without touching other-org sessions", async () => {
    // Fresh sessions in both orgs for this scenario.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "switcher@example.com", password: "OriginalPassword123" });
    const homeToken = login.body.data.session.token;

    const switchRes = await request(app)
      .post("/api/v1/auth/switch-organization")
      .set("Authorization", `Bearer ${homeToken}`)
      .send({ organizationId: secondOrgId });
    const secondOrgToken = switchRes.body.data.session.token;

    // Revoke the membership in secondOrg directly (simulates an admin removing access).
    await prisma.organizationMembership.delete({
      where: { userId_organizationId: { userId, organizationId: secondOrgId } },
    });

    const secondOrgCheck = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${secondOrgToken}`);
    expect(secondOrgCheck.status).toBe(401);

    // A fresh login to the home org still works — the user's other membership is untouched.
    const freshHomeLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "switcher@example.com", password: "OriginalPassword123" });
    expect(freshHomeLogin.status).toBe(200);
    expect(freshHomeLogin.body.data.user.organizationId).toBe(homeOrgId);
  });
});
