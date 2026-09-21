/**
 * Shared role/permission seeding logic — the reference data (not tenant
 * data) every environment needs to exist before auth can work at all
 * (authService.register looks up the ADMIN role by key). Imported by both
 * prisma/seed.ts (developer-run, also seeds one bootstrap admin) and
 * tests/setup.ts (idempotent upsert, run once before the suite; tenant
 * data — organizations/users/sessions/audit_logs — is wiped and rebuilt
 * per test via tests/helpers/db.ts's resetDb(), but this reference data
 * is not, matching how a real deployment treats its role/permission
 * catalog as stable configuration, not per-test fixture data).
 */
import type { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS, ROLE_DEFINITIONS, SYSTEM_ROLE_KEYS, type RoleKey } from "../server/types/domain";

function moduleOf(key: string): string {
  return key.split(".")[0] ?? key;
}

function permissionName(key: string): string {
  const [, action] = key.split(".");
  return `${moduleOf(key)}: ${action ?? key}`.replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROLE_PERMISSION_SETS: Record<RoleKey, readonly string[] | "*"> = {
  SUPER_ADMIN: "*",
  ADMIN: [
    "users.read",
    "users.create",
    "users.update",
    "organizations.read",
    "organizations.update",
    "organizations.manage_members",
    "roles.read",
    "roles.assign",
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.delete",
    "leads.convert",
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "contacts.delete",
    "products.read",
    "products.create",
    "products.update",
    "products.archive",
    "product_modules.read",
    "product_modules.create",
    "product_modules.update",
    "product_modules.archive",
    "product_modules.reorder",
    "content.read",
    "content.create",
    "content.update",
    "content.publish",
    "content.delete",
    "authors.read",
    "authors.create",
    "authors.update",
    "media.read",
    "media.upload",
    "media.update",
    "media.delete",
    "reports.read",
    "reports.export",
    "settings.read",
    "settings.manage",
    "audit.read",
    "ai.use",
    "ai.manage",
    "automation.read",
    "automation.create",
    "automation.edit",
    "automation.publish",
    "automation.execute",
    "automation.approve",
    "automation.manage",
    "onboarding.read",
    "onboarding.create",
    "onboarding.update",
    "onboarding.complete",
    "workspaces.read",
    "workspaces.create",
    "workspaces.update",
    "workspaces.suspend",
    "invitations.read",
    "invitations.create",
    "invitations.revoke",
    // Phase 10 — ADMIN gets the full commercial/billing set, including the
    // sensitive transitions (activate/suspend/terminate/variations.create,
    // issue/void, reverse) that MANAGER/USER/VIEWER do not (§34).
    "contracts.read",
    "contracts.create",
    "contracts.update",
    "contracts.activate",
    "contracts.suspend",
    "contracts.terminate",
    "contracts.variations.create",
    "subscriptions.read",
    "subscriptions.create",
    "subscriptions.update",
    "subscriptions.activate",
    "subscriptions.pause",
    "subscriptions.cancel",
    "invoices.read",
    "invoices.create",
    "invoices.update",
    "invoices.issue",
    "invoices.void",
    "payments.read",
    "payments.create",
    "payments.reverse",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
  ],
  MANAGER: [
    "users.read",
    "clients.read",
    "clients.create",
    "clients.update",
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.convert",
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "products.read",
    "products.create",
    "products.update",
    "product_modules.read",
    "product_modules.create",
    "product_modules.update",
    "product_modules.reorder",
    "content.read",
    "content.create",
    "content.update",
    "authors.read",
    "authors.update",
    "media.read",
    "media.upload",
    "media.update",
    "reports.read",
    "ai.use",
    "automation.read",
    "automation.execute",
    "automation.approve",
    "onboarding.read",
    "onboarding.create",
    "onboarding.update",
    "workspaces.read",
    "workspaces.create",
    "workspaces.update",
    "invitations.read",
    "invitations.create",
    // Phase 10 — MANAGER gets read/create/update plus the reversible
    // subscription transitions, but not contract termination/variations,
    // invoice issue/void, or payment reversal (§34, reserved for ADMIN).
    "contracts.read",
    "contracts.create",
    "contracts.update",
    "subscriptions.read",
    "subscriptions.create",
    "subscriptions.update",
    "subscriptions.activate",
    "subscriptions.pause",
    "subscriptions.cancel",
    "invoices.read",
    "invoices.create",
    "invoices.update",
    "payments.read",
    "payments.create",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
  ],
  USER: [
    "clients.read",
    "leads.read",
    "leads.create",
    "leads.update",
    "contacts.read",
    "products.read",
    "product_modules.read",
    "content.read",
    "content.create",
    "authors.read",
    "media.read",
    "media.upload",
    "reports.read",
    "ai.use",
    "automation.read",
    "automation.execute",
    "onboarding.read",
    "workspaces.read",
    "invitations.read",
    // Phase 10 — USER gets read-only commercial access plus the client
    // portal (§25/§26).
    "contracts.read",
    "subscriptions.read",
    "invoices.read",
    "payments.read",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
  ],
  VIEWER: [
    "users.read",
    "organizations.read",
    "roles.read",
    "clients.read",
    "leads.read",
    "contacts.read",
    "products.read",
    "product_modules.read",
    "content.read",
    "authors.read",
    "media.read",
    "reports.read",
    "settings.read",
    "audit.read",
    "automation.read",
    "onboarding.read",
    "workspaces.read",
    "invitations.read",
    // Phase 10 — VIEWER gets read-only commercial access plus the client
    // portal (§25/§26).
    "contracts.read",
    "subscriptions.read",
    "invoices.read",
    "payments.read",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
  ],
};

export async function seedRolesAndPermissions(prisma: PrismaClient): Promise<Record<RoleKey, string>> {
  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, name: permissionName(key), module: moduleOf(key) },
    });
  }

  const roleIds = {} as Record<RoleKey, string>;

  for (const key of SYSTEM_ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    const role = await prisma.role.upsert({
      where: { key },
      update: {},
      create: { key, name: def.name, description: def.description, isSystem: true },
    });
    roleIds[key] = role.id;

    const grantedKeys = ROLE_PERMISSION_SETS[key] === "*" ? PERMISSION_KEYS : ROLE_PERMISSION_SETS[key];
    const permissions = await prisma.permission.findMany({ where: { key: { in: [...grantedKeys] } } });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  return roleIds;
}
