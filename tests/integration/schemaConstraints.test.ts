/**
 * Phase 2 §36/§52 — database constraints must protect integrity even if
 * the API layer is bypassed. Every test here writes directly through
 * Prisma (not through a service), because that's exactly the boundary
 * these constraints are meant to hold even without one.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma, disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

const P2002_UNIQUE_VIOLATION = "P2002";
const P2003_FK_VIOLATION = "P2003";

function isPrismaKnownError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

describe("schema constraints (Phase 2 §36/§52)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await disconnectPrisma();
  });

  it("rejects a duplicate user email (global uniqueness)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org A", slug: "org-a" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email: "dup@example.com",
        passwordHash: "x",
        firstName: "A",
        lastName: "B",
        roleId: role.id,
      },
    });

    await expect(
      prisma.user.create({
        data: {
          organizationId: org.id,
          email: "dup@example.com",
          passwordHash: "x",
          firstName: "C",
          lastName: "D",
          roleId: role.id,
        },
      })
    ).rejects.toSatisfy((err: unknown) => isPrismaKnownError(err, P2002_UNIQUE_VIOLATION));
  });

  it("rejects a duplicate organization slug", async () => {
    await prisma.organization.create({ data: { name: "Org B", slug: "dup-slug" } });
    await expect(prisma.organization.create({ data: { name: "Org B2", slug: "dup-slug" } })).rejects.toSatisfy(
      (err: unknown) => isPrismaKnownError(err, P2002_UNIQUE_VIOLATION)
    );
  });

  it("rejects a duplicate permission key", async () => {
    await expect(
      prisma.permission.create({ data: { key: "users.read", name: "dup", module: "users" } })
    ).rejects.toSatisfy((err: unknown) => isPrismaKnownError(err, P2002_UNIQUE_VIOLATION));
  });

  it("rejects a duplicate role_permissions mapping", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "users.read" } });
    // VIEWER already has users.read from the seed — this must conflict.
    await expect(
      prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } })
    ).rejects.toSatisfy((err: unknown) => isPrismaKnownError(err, P2002_UNIQUE_VIOLATION));
  });

  it("rejects a duplicate active organization_membership for the same user+organization", async () => {
    const org = await prisma.organization.create({ data: { name: "Org C", slug: "org-c" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "USER" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: "member@example.com", passwordHash: "x", firstName: "A", lastName: "B", roleId: role.id },
    });
    await prisma.organizationMembership.create({ data: { userId: user.id, organizationId: org.id, roleId: role.id } });

    await expect(
      prisma.organizationMembership.create({ data: { userId: user.id, organizationId: org.id, roleId: role.id } })
    ).rejects.toSatisfy((err: unknown) => isPrismaKnownError(err, P2002_UNIQUE_VIOLATION));
  });

  it("rejects a foreign key referencing a nonexistent organization", async () => {
    await expect(
      prisma.lead.create({
        data: { organizationId: "00000000-0000-0000-0000-000000000000", companyName: "Ghost Co" },
      })
    ).rejects.toSatisfy((err: unknown) => isPrismaKnownError(err, P2003_FK_VIOLATION));
  });

  it("rejects a negative contract value at the database level (CHECK constraint, not just app validation)", async () => {
    const org = await prisma.organization.create({ data: { name: "Org D", slug: "org-d" } });
    const client = await prisma.client.create({ data: { organizationId: org.id, clientCode: "C-1", name: "Client One" } });

    await expect(
      prisma.contract.create({
        data: {
          contractNumber: "CN-NEG-1",
          title: "Negative Value Contract",
          organizationId: org.id,
          clientId: client.id,
          startDate: new Date("2026-01-01"),
          contractValue: new Prisma.Decimal("-100.000"),
          currency: "OMR",
        },
      })
    ).rejects.toThrow(); // raw CHECK constraint violation, not a Prisma-known-error code
  });

  it("rejects an invoice due_date before its issue_date at the database level", async () => {
    const org = await prisma.organization.create({ data: { name: "Org E", slug: "org-e" } });
    const client = await prisma.client.create({ data: { organizationId: org.id, clientCode: "C-2", name: "Client Two" } });

    await expect(
      prisma.invoice.create({
        data: {
          invoiceNumber: "INV-BAD-DATES",
          organizationId: org.id,
          clientId: client.id,
          issueDate: new Date("2026-06-01"),
          dueDate: new Date("2026-05-01"),
          currency: "OMR",
          subtotal: new Prisma.Decimal("10.000"),
          total: new Prisma.Decimal("10.000"),
          amountDue: new Prisma.Decimal("10.000"),
        },
      })
    ).rejects.toThrow();
  });

  it("rejects a content_revision with neither a page nor a post (CHECK: exactly one parent)", async () => {
    await expect(
      prisma.contentRevision.create({
        data: { version: 1, status: "DRAFT", title: "Orphan revision", body: "..." },
      })
    ).rejects.toThrow();
  });

  it("preserves exact decimal precision for a 3-decimal-place currency (OMR) value — no floating-point drift", async () => {
    const org = await prisma.organization.create({ data: { name: "Org F", slug: "org-f" } });
    const client = await prisma.client.create({ data: { organizationId: org.id, clientCode: "C-3", name: "Client Three" } });

    const contract = await prisma.contract.create({
      data: {
        contractNumber: "CN-PRECISE-1",
        title: "Precise Value Contract",
        organizationId: org.id,
        clientId: client.id,
        startDate: new Date("2026-01-01"),
        contractValue: new Prisma.Decimal("1000.125"),
        currency: "OMR",
      },
    });

    const reloaded = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    // Exact string comparison, not floating-point equality — Prisma.Decimal
    // preserves the value as a string-backed arbitrary-precision type.
    expect(reloaded.contractValue.toString()).toBe("1000.125");
    expect(reloaded.contractValue.toFixed(3)).toBe("1000.125");
  });

  it("rolls back an entire transaction when one statement inside it fails (registration-style atomicity)", async () => {
    const orgCountBefore = await prisma.organization.count();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.organization.create({ data: { name: "Rollback Org", slug: "rollback-org" } });
        // Second statement fails (duplicate permission key) — the whole
        // transaction, including the organization insert above, must roll back.
        await tx.permission.create({ data: { key: "users.read", name: "dup", module: "users" } });
      })
    ).rejects.toThrow();

    const orgCountAfter = await prisma.organization.count();
    expect(orgCountAfter).toBe(orgCountBefore); // the org insert was rolled back, not left dangling
    expect(await prisma.organization.findUnique({ where: { slug: "rollback-org" } })).toBeNull();
  });
});
