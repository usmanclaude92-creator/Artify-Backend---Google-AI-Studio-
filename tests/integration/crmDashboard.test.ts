/** Phase 5 §21 — CRM dashboard summary: real counts only, degrades per-permission. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("GET /api/v1/crm/summary", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "dash-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Dash",
      lastName: "Admin",
      organizationName: "Dash Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app).post("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`).send({ companyName: "Dash Lead 1" });
    await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Dash Lead 2", status: "QUALIFIED" });
    await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "DASH-01", name: "Dash Client" });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/crm/summary");
    expect(res.status).toBe(401);
  });

  it("returns real counts computed from the database — no fake numbers", async () => {
    const res = await request(app).get("/api/v1/crm/summary").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.leads.total).toBe(2);
    expect(res.body.data.leads.new).toBe(1);
    expect(res.body.data.leads.qualified).toBe(1);
    expect(res.body.data.clients.total).toBe(1);
    expect(res.body.data.clients.prospect).toBe(1);
    expect(Array.isArray(res.body.data.leads.recent)).toBe(true);
    expect(Array.isArray(res.body.data.clients.recent)).toBe(true);
  });

  it("a caller without leads.read sees clients but not lead counts (degrades per-permission, never fabricates)", async () => {
    // Custom role with only clients.read for this test. resetDb()
    // deliberately never touches roles/permissions (reference data, see
    // tests/helpers/db.ts) — this test creates its own extra role, so it
    // must clean it up itself, exactly like tests/security/
    // rbacAndAudit.test.ts's "changing role_permissions..." test does,
    // otherwise it leaks into later test files' exact-role-list
    // assertions (e.g. userManagement.test.ts).
    const { prisma } = await import("../../server/db/prisma");
    const { hashPassword } = await import("../../server/utils/password");

    const clientsOnlyRole = await prisma.role.create({
      data: { key: "TEST_CLIENTS_ONLY", name: "Test Clients Only", isSystem: false },
    });
    const clientsReadPerm = await prisma.permission.findUniqueOrThrow({ where: { key: "clients.read" } });
    await prisma.rolePermission.create({ data: { roleId: clientsOnlyRole.id, permissionId: clientsReadPerm.id } });

    let newUserId: string | undefined;
    try {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "dash-admin@example.com" } });
      const newUser = await prisma.user.create({
        data: {
          organizationId: admin.organizationId,
          email: "dash-clientsonly@example.com",
          passwordHash: await hashPassword("ClientsOnlyPassword123"),
          firstName: "Clients",
          lastName: "Only",
          roleId: clientsOnlyRole.id,
        },
      });
      newUserId = newUser.id;
      await prisma.organizationMembership.create({
        data: { userId: newUser.id, organizationId: admin.organizationId, roleId: clientsOnlyRole.id, status: "ACTIVE", isPrimary: true },
      });

      const login = await request(app).post("/api/v1/auth/login").send({ email: "dash-clientsonly@example.com", password: "ClientsOnlyPassword123" });

      const res = await request(app).get("/api/v1/crm/summary").set("Authorization", `Bearer ${login.body.data.session.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.clients).not.toBeNull();
      expect(res.body.data.leads).toBeNull();
    } finally {
      if (newUserId) {
        await prisma.session.deleteMany({ where: { userId: newUserId } });
        await prisma.organizationMembership.deleteMany({ where: { userId: newUserId } });
        await prisma.user.delete({ where: { id: newUserId } });
      }
      await prisma.rolePermission.deleteMany({ where: { roleId: clientsOnlyRole.id } });
      await prisma.role.delete({ where: { id: clientsOnlyRole.id } });
    }
  });
});
