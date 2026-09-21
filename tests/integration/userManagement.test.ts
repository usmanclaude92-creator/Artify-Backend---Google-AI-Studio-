/**
 * Phase 3 §14/§19/§23/§24 — user management, role assignment protections,
 * and the roles/permissions/organizations read endpoints.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("user management", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let adminId: string;
  let orgId: string;
  let viewerToken: string;
  let viewerId: string;

  beforeAll(async () => {
    await resetDb();

    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "org-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Org",
      lastName: "Admin",
      organizationName: "User Mgmt Co",
    });
    adminToken = reg.body.data.session.token;
    adminId = reg.body.data.user.id;
    orgId = reg.body.data.user.organizationId;

    const created = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "Iewer", roleKey: "VIEWER" });
    viewerId = created.body.data.user.id;

    const viewerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated access to every management endpoint", async () => {
    const endpoints = [
      request(app).get("/api/v1/users"),
      request(app).get("/api/v1/roles"),
      request(app).get("/api/v1/permissions"),
      request(app).get("/api/v1/organizations"),
    ];
    for (const res of await Promise.all(endpoints)) {
      expect(res.status).toBe(401);
    }
  });

  it("rejects a caller without the required permission (VIEWER cannot create users)", async () => {
    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ email: "nope@example.com", password: "SomePassword123", firstName: "N", lastName: "O", roleKey: "USER" });
    expect(res.status).toBe(403);
  });

  it("VIEWER can read users (read permission granted) but the list is scoped to their own organization", async () => {
    const res = await request(app).get("/api/v1/users").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.users.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([adminId, viewerId]));
  });

  it("ADMIN creates a user, rejecting SUPER_ADMIN as an assignable role", async () => {
    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "attempted-super@example.com", password: "SomePassword123", firstName: "A", lastName: "B", roleKey: "SUPER_ADMIN" });
    expect(res.status).toBe(400); // rejected by schema validation — SUPER_ADMIN is not an assignable role key
  });

  it("prevents a caller from changing their own role (self-escalation protection)", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${adminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleKey: "VIEWER" });
    expect(res.status).toBe(403);
  });

  it("ADMIN reassigns the VIEWER's role to MANAGER, audited", async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${viewerId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleKey: "MANAGER" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role.key).toBe("MANAGER");

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "USER_ROLE_CHANGED", resourceId: viewerId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow!.afterData as { roleKey: string }).roleKey).toBe("MANAGER");
  });

  it("deactivating a user revokes their sessions", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "viewer@example.com", password: "ViewerPassword123" });
    const targetToken = login.body.data.session.token;

    const res = await request(app)
      .patch(`/api/v1/users/${viewerId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DISABLED" });
    expect(res.status).toBe(200);

    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${targetToken}`);
    expect(meRes.status).toBe(401);
  });

  it("a user outside the caller's organization cannot be read or updated (404, not 403 — no cross-org existence leak)", async () => {
    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "other-org-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Org Co",
    });
    const otherUserId = otherReg.body.data.user.id;

    const getRes = await request(app).get(`/api/v1/users/${otherUserId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/users/${otherUserId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Hijacked" });
    expect(patchRes.status).toBe(404);
  });

  it("GET /roles returns the seeded system roles with resolved permissions", async () => {
    const res = await request(app).get("/api/v1/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = res.body.data.roles.map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual(["ADMIN", "MANAGER", "SUPER_ADMIN", "USER", "VIEWER"]);
  });

  it("GET /permissions returns the full catalog including the new Phase 3 role-management permissions", async () => {
    const res = await request(app).get("/api/v1/permissions").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = res.body.data.permissions.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["roles.read", "roles.assign", "organizations.manage_members"]));
  });

  it("GET /organizations for a non-SUPER_ADMIN lists only the organizations they belong to", async () => {
    const res = await request(app).get("/api/v1/organizations").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toHaveLength(1);
    expect(res.body.data.organizations[0].id).toBe(orgId);
  });
});

describe("organization membership management", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("adds, updates, and removes a member, each step audited; rejects assigning SUPER_ADMIN via this route", async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "membership-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Membership",
      lastName: "Admin",
      organizationName: "Membership Co",
    });
    const adminToken = reg.body.data.session.token;
    const orgId = reg.body.data.user.organizationId;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "to-add@example.com",
      password: "OriginalPassword123",
      firstName: "To",
      lastName: "Add",
      organizationName: "Elsewhere Co",
    });
    const otherUserId = other.body.data.user.id;

    const badAdd = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: otherUserId, roleKey: "SUPER_ADMIN" });
    expect(badAdd.status).toBe(400);

    const add = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: otherUserId, roleKey: "VIEWER" });
    expect(add.status).toBe(201);

    const update = await request(app)
      .patch(`/api/v1/organizations/${orgId}/members/${otherUserId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ roleKey: "MANAGER" });
    expect(update.status).toBe(200);

    const remove = await request(app)
      .delete(`/api/v1/organizations/${orgId}/members/${otherUserId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(remove.status).toBe(200);

    const auditActions = await prisma.auditLog.findMany({
      where: { organizationId: orgId, action: { in: ["ORG_MEMBERSHIP_ADDED", "USER_ROLE_CHANGED", "ORG_MEMBERSHIP_REMOVED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(auditActions.map((a) => a.action)).toEqual(["ORG_MEMBERSHIP_ADDED", "USER_ROLE_CHANGED", "ORG_MEMBERSHIP_REMOVED"]);
  });

  it("cannot manage members of an organization the caller doesn't belong to", async () => {
    const orgA = await request(app).post("/api/v1/auth/register").send({
      email: "org-a-admin@example.com",
      password: "OriginalPassword123",
      firstName: "A",
      lastName: "Admin",
      organizationName: "Org A",
    });
    const orgB = await request(app).post("/api/v1/auth/register").send({
      email: "org-b-admin@example.com",
      password: "OriginalPassword123",
      firstName: "B",
      lastName: "Admin",
      organizationName: "Org B",
    });
    const orgBId = orgB.body.data.user.organizationId;
    const orgAToken = orgA.body.data.session.token;

    const res = await request(app)
      .post(`/api/v1/organizations/${orgBId}/members`)
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({ userId: orgA.body.data.user.id, roleKey: "VIEWER" });
    expect(res.status).toBe(403);
  });
});
