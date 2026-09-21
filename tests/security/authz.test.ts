/**
 * Security regression suite for the auth/RBAC middleware foundation
 * (server/middleware/auth.ts). No business routes exist yet to mount these
 * on (that's Phase 4+), so this suite builds a minimal throwaway route
 * inside the test file itself, using the REAL middleware functions, to
 * prove: missing auth is rejected, wrong permission is rejected, and
 * cross-tenant access is rejected (see docs/AUTHORIZATION_MODEL.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { requestIdMiddleware } from "../../server/middleware/requestId";
import { errorHandlerMiddleware, notFoundHandler } from "../../server/middleware/errorHandler";
import {
  authenticateToken,
  enforceTenantIsolation,
  requirePermission,
  requireRole,
} from "../../server/middleware/auth";
import { authService } from "../../server/services/authService";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

function buildTestApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  // A protected resource-list route: any authenticated user may call it.
  app.get("/protected/whoami", authenticateToken, (req, res) => {
    res.json({ userId: req.user?.id, role: req.user?.role.key });
  });

  // Requires a permission the default self-registration (ADMIN role) does NOT grant
  // (role management itself is SUPER_ADMIN-only — ADMIN has roles.read/roles.assign
  // but not roles.create; Phase 7 gave ADMIN products.create as part of normal
  // platform-catalog administration, so that permission no longer fits this case).
  app.get("/protected/super-admin-permission-only", authenticateToken, requirePermission("roles.create"), (_req, res) => {
    res.json({ ok: true });
  });

  // Requires a specific role.
  app.get("/protected/super-admin-role-only", authenticateToken, requireRole(["SUPER_ADMIN"]), (_req, res) => {
    res.json({ ok: true });
  });

  // Simulates a single-record route scoped by organizationId query param.
  app.get("/protected/tenant-scoped", authenticateToken, enforceTenantIsolation, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(notFoundHandler);
  app.use(errorHandlerMiddleware);
  return app;
}

describe("authorization middleware foundation (security regression suite)", () => {
  const app = buildTestApp();

  let tenantAToken: string;
  let tenantAOrganizationId: string;
  let tenantBToken: string;
  let tenantBOrganizationId: string;

  beforeAll(async () => {
    await resetDb();

    const a = await authService.register({
      email: "tenant-a-admin@example.com",
      password: "CorrectHorseBatteryStaple123",
      firstName: "Tenant",
      lastName: "A Admin",
      organizationName: "Tenant A Corp",
    });
    tenantAToken = a.session.token;
    tenantAOrganizationId = a.user.organizationId;

    const b = await authService.register({
      email: "tenant-b-admin@example.com",
      password: "CorrectHorseBatteryStaple123",
      firstName: "Tenant",
      lastName: "B Admin",
      organizationName: "Tenant B Corp",
    });
    tenantBToken = b.session.token;
    tenantBOrganizationId = b.user.organizationId;
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  describe("authentication is required", () => {
    it("rejects a request with no Authorization header", async () => {
      const res = await request(app).get("/protected/whoami");
      expect(res.status).toBe(401);
    });

    it("rejects a request with an invalid Bearer token", async () => {
      const res = await request(app).get("/protected/whoami").set("Authorization", "Bearer garbage-token-value");
      expect(res.status).toBe(401);
    });

    it("accepts a request with a valid session token", async () => {
      const res = await request(app).get("/protected/whoami").set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("ADMIN");
    });
  });

  describe("vertical privilege escalation is blocked", () => {
    it("rejects an ADMIN calling a route requiring roles.create (a SUPER_ADMIN-only role-management permission)", async () => {
      const res = await request(app)
        .get("/protected/super-admin-permission-only")
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects an ADMIN calling a SUPER_ADMIN-role-only route", async () => {
      const res = await request(app)
        .get("/protected/super-admin-role-only")
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("horizontal privilege escalation / tenant isolation is blocked", () => {
    it("allows a user to access a resource scoped to their own organizationId", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?organizationId=${tenantAOrganizationId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
    });

    it("rejects tenant A's user requesting a resource scoped to tenant B's organizationId", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?organizationId=${tenantBOrganizationId}`)
        .set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("TENANT_ISOLATION_ERROR");
    });

    it("rejects tenant B's user requesting a resource scoped to tenant A's organizationId (symmetric check)", async () => {
      const res = await request(app)
        .get(`/protected/tenant-scoped?organizationId=${tenantAOrganizationId}`)
        .set("Authorization", `Bearer ${tenantBToken}`);
      expect(res.status).toBe(403);
    });

    it("allows a request with no organizationId filter at all (list-your-own-scope pattern)", async () => {
      const res = await request(app).get("/protected/tenant-scoped").set("Authorization", `Bearer ${tenantAToken}`);
      expect(res.status).toBe(200);
    });
  });
});
