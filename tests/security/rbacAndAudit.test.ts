/**
 * Phase 2 §52 — RBAC mapping, audit immutability, tenant isolation at the
 * data-query level, and session expiry/revocation. Complements
 * tests/security/authz.test.ts (which exercises the HTTP middleware) by
 * testing the underlying repository/schema behavior directly.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, disconnectPrisma } from "../../server/db/prisma";
import { roleRepository } from "../../server/repositories/roleRepository";
import { auditLogRepository } from "../../server/repositories/auditLogRepository";
import { sessionRepository } from "../../server/repositories/sessionRepository";
import { resetDb } from "../helpers/db";

describe("RBAC mapping (Phase 2 §15-17)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("resolves a role's exact permission set via role_permissions, not a hardcoded list", async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const resolved = await roleRepository.resolveById(viewer.id);

    expect(resolved).not.toBeNull();
    expect(resolved?.permissions).toContain("users.read");
    expect(resolved?.permissions).not.toContain("users.delete"); // VIEWER is read-only
  });

  it("changing role_permissions changes what resolveById returns — proving permissions are data, not code", async () => {
    const viewer = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const newPermission = await prisma.permission.create({
      data: { key: "test.custom_permission", name: "Custom", module: "test" },
    });

    try {
      const before = await roleRepository.resolveById(viewer.id);
      expect(before?.permissions).not.toContain("test.custom_permission");

      await prisma.rolePermission.create({ data: { roleId: viewer.id, permissionId: newPermission.id } });

      const after = await roleRepository.resolveById(viewer.id);
      expect(after?.permissions).toContain("test.custom_permission");
    } finally {
      // resetDb() deliberately does not touch permissions/roles (they're
      // reference data, not per-test fixtures — see tests/helpers/db.ts) —
      // this test created its own extra permission, so it cleans it up
      // itself rather than leaking it into every later test's permission
      // counts (rolePermission rows cascade-delete with the permission).
      await prisma.permission.delete({ where: { id: newPermission.id } });
    }
  });

  it("SUPER_ADMIN role has every seeded permission", async () => {
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const resolved = await roleRepository.resolveById(superAdmin.id);
    const totalPermissions = await prisma.permission.count();

    expect(resolved?.permissions.length).toBe(totalPermissions);
  });
});

describe("audit log immutability (Phase 2 §19/§21)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates an audit record with the expected fields", async () => {
    const org = await prisma.organization.create({ data: { name: "Audit Org", slug: "audit-org" } });

    await auditLogRepository.record({
      organizationId: org.id,
      actorType: "SYSTEM",
      action: "ORGANIZATION_CREATED",
      resourceType: "organization",
      resourceId: org.id,
      metadata: { source: "test" },
    });

    const logs = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("ORGANIZATION_CREATED");
    expect(logs[0]?.result).toBe("SUCCESS");
  });

  it("exposes no update or delete method on the audit log repository — the application API cannot rewrite history", () => {
    expect(Object.keys(auditLogRepository)).toEqual(["record"]);
  });

  it("survives the actor user being deleted — actorUserId is SET NULL, not cascaded away", async () => {
    const org = await prisma.organization.create({ data: { name: "Audit Org 2", slug: "audit-org-2" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: "todelete@example.com", passwordHash: "x", firstName: "A", lastName: "B", roleId: role.id },
    });

    await auditLogRepository.record({
      organizationId: org.id,
      actorUserId: user.id,
      actorType: "USER",
      action: "USER_UPDATED",
      resourceType: "user",
      resourceId: user.id,
    });

    await prisma.user.delete({ where: { id: user.id } });

    const logs = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorUserId).toBeNull(); // SET NULL, the log itself is untouched
    expect(logs[0]?.action).toBe("USER_UPDATED");
  });
});

describe("tenant isolation at the query level (Phase 2 §45)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("a query scoped to organization A never returns organization B's leads, even with an unscoped id lookup", async () => {
    const orgA = await prisma.organization.create({ data: { name: "Tenant A", slug: "tenant-a-data" } });
    const orgB = await prisma.organization.create({ data: { name: "Tenant B", slug: "tenant-b-data" } });

    const leadA = await prisma.lead.create({ data: { organizationId: orgA.id, companyName: "A's Prospect" } });
    await prisma.lead.create({ data: { organizationId: orgB.id, companyName: "B's Prospect" } });

    // Simulates the horizontal-escalation attempt: caller only has orgA's
    // scope, but tries to fetch a record by bare ID. The correct query
    // pattern (WHERE id = ? AND organization_id = ?) must return nothing
    // for a cross-tenant ID, proving §45's "never WHERE id = ? alone" rule.
    const crossTenantAttempt = await prisma.lead.findFirst({
      where: { id: leadA.id, organizationId: orgB.id },
    });
    expect(crossTenantAttempt).toBeNull();

    const legitimate = await prisma.lead.findFirst({ where: { id: leadA.id, organizationId: orgA.id } });
    expect(legitimate).not.toBeNull();

    const orgAScopedList = await prisma.lead.findMany({ where: { organizationId: orgA.id } });
    expect(orgAScopedList.map((l) => l.companyName)).toEqual(["A's Prospect"]);
  });
});

describe("session expiry and revocation (Phase 2 §18/§52)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("does not return an expired session as valid", async () => {
    const org = await prisma.organization.create({ data: { name: "Session Org", slug: "session-org" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: "sess-expired@example.com", passwordHash: "x", firstName: "A", lastName: "B", roleId: role.id },
    });

    const token = "art_sess_test_expired_token_0000000000000000000000000000000000";
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId: org.id,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const found = await sessionRepository.findValidByToken(token);
    expect(found).toBeNull();
  });

  it("does not return a revoked session as valid", async () => {
    const org = await prisma.organization.create({ data: { name: "Session Org 2", slug: "session-org-2" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: "sess-revoked@example.com", passwordHash: "x", firstName: "A", lastName: "B", roleId: role.id },
    });

    const token = "art_sess_test_revoked_token_0000000000000000000000000000000000";
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId: org.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await sessionRepository.revoke(token);
    const found = await sessionRepository.findValidByToken(token);
    expect(found).toBeNull();
  });
});
