import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { authService } from "../../server/services/authService";
import { hashPassword } from "../../server/utils/password";
import { resetDb } from "../helpers/db";

describe("liveness and readiness (Phase 1 §10 — real DB checks, no fake status)", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET /api/v1/system/live returns 200 without touching the database", async () => {
    const res = await request(app).get("/api/v1/system/live");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("alive");
  });

  it("GET /api/v1/system/ready returns 200 and reports a real, healthy Postgres dependency", async () => {
    const res = await request(app).get("/api/v1/system/ready");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ready");
    const dbDep = res.body.data.dependencies.find((d: { name: string }) => d.name === "postgresql");
    expect(dbDep).toBeDefined();
    expect(dbDep.healthy).toBe(true);
    expect(typeof dbDep.latencyMs).toBe("number");
  });

  it("every response carries a correlation request id header (Phase 1 §13)", async () => {
    const res = await request(app).get("/api/v1/system/live");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("returns a standard 404 envelope for an unknown /api route, not a leaked stack trace", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("GET /api/v1/system/database (Phase 2 §57/§67 — authenticated, SUPER_ADMIN-only, no secrets exposed)", () => {
  const app = createApp();
  finalizeApp(app);

  beforeAll(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/system/database");
    expect(res.status).toBe(401);
  });

  it("rejects a non-SUPER_ADMIN authenticated user", async () => {
    const { session } = await authService.register({
      email: "db-check-non-admin@example.com",
      password: "CorrectHorseBatteryStaple123",
      firstName: "Regular",
      lastName: "Admin",
      organizationName: "DB Check Co",
    });

    const res = await request(app).get("/api/v1/system/database").set("Authorization", `Bearer ${session.token}`);
    expect(res.status).toBe(403);
  });

  it("reports safe migration/count metadata to a SUPER_ADMIN, with no connection string or credentials anywhere in the response", async () => {
    const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const org = await prisma.organization.create({
      data: { name: "DB Check Internal", slug: "db-check-internal", type: "INTERNAL" },
    });
    const passwordHash = await hashPassword("CorrectHorseBatteryStaple123");
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "db-check-super-admin@example.com",
        passwordHash,
        firstName: "Super",
        lastName: "Admin",
        roleId: superAdminRole.id,
      },
    });
    // Phase 3: login resolves the caller's role via an active
    // OrganizationMembership, not User.roleId directly — a user with no
    // membership row has no usable session (see authService.login).
    await prisma.organizationMembership.create({
      data: { userId: user.id, organizationId: org.id, roleId: superAdminRole.id, status: "ACTIVE", isPrimary: true },
    });

    const login = await authService.login("db-check-super-admin@example.com", "CorrectHorseBatteryStaple123");

    const res = await request(app)
      .get("/api/v1/system/database")
      .set("Authorization", `Bearer ${login.session.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("PostgreSQL");
    expect(res.body.data.healthy).toBe(true);
    expect(Array.isArray(res.body.data.migrations.names)).toBe(true);
    expect(res.body.data.migrations.applied).toBeGreaterThan(0);
    expect(typeof res.body.data.counts.organizations).toBe("number");

    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/postgresql:\/\//); // no connection string
    expect(raw.toLowerCase()).not.toContain("password");
  });
});
