/**
 * Identity domain types — Phase 2. Roles and permissions are now real
 * database rows (`roles`, `permissions`, `role_permissions` — see
 * docs/ADR/ADR-011-permission-based-rbac-schema.md), not the Phase 1
 * Prisma enum + flat array. `RoleKey`/`PermissionKey` remain TypeScript
 * literal unions purely for compile-time safety at route-decoration call
 * sites (`requirePermission("users.read")`); the runtime source of truth
 * is always the database.
 */
import type { User as PrismaUser } from "@prisma/client";

/** The 5 built-in system roles seeded by prisma/seed.ts. Custom roles (not built in Phase 2) would extend this at runtime without a corresponding TS literal. */
export const SYSTEM_ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "VIEWER"] as const;
export type RoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const ROLE_DEFINITIONS: Readonly<Record<RoleKey, { name: string; description: string }>> = {
  SUPER_ADMIN: {
    name: "Super Administrator",
    description: "Full platform access across all organizations. Reserved for Artify's own platform operators.",
  },
  ADMIN: {
    name: "Administrator",
    description: "Full access within the administrator's own organization.",
  },
  MANAGER: {
    name: "Manager",
    description: "Manages day-to-day operations (CRM, content, products) within the organization.",
  },
  USER: {
    name: "User",
    description: "Standard operational access within the organization.",
  },
  VIEWER: {
    name: "Viewer",
    description: "Read-only access within the organization.",
  },
};

/**
 * Permission catalog (docs/ADR-011). Namespaced `<module>.<action>` —
 * seeded into the `permissions` table by prisma/seed.ts and mapped to
 * roles via `role_permissions`. This union exists for compile-time safety
 * only; adding a permission means updating both this list and the seed.
 */
export const PERMISSION_KEYS = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "organizations.read",
  "organizations.create",
  "organizations.update",
  "organizations.delete",
  "organizations.manage_members",
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.delete",
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
  "ai.read",
  "ai.use",
  "ai.manage",
  "ai.approve",
  "ai.admin",
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
  // Phase 10 — commercial/billing (docs/COMMERCIAL_ARCHITECTURE.md,
  // docs/BILLING_ARCHITECTURE.md). Sensitive financial actions
  // (activate/suspend/terminate/variations.create, issue/void,
  // reverse) are deliberately separate from read/create/update — §34.
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
  // Client Portal — read-only client-facing capabilities, deliberately
  // separate from the internal contracts.*/invoices.*/payments.* keys
  // above (§25/§26). Granted broadly (every internal role too, so an
  // agency user who switches their session into a client's workspace
  // organization can see that workspace's own portal) — the real
  // boundary is portalService resolving the caller's Client record from
  // their session's own organizationId, never a client-supplied id.
  "portal.dashboard.read",
  "portal.contracts.read",
  "portal.subscriptions.read",
  "portal.invoices.read",
  "portal.payments.read",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** A resolved role + its permission set, attached to a session on verification (never stored redundantly per-user). */
export interface ResolvedRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

/**
 * A User row with the password hash stripped — the only shape allowed to
 * leave the service layer — plus the role/permissions resolved for the
 * CURRENT SESSION's organization context (Phase 3 —
 * docs/AUTHENTICATION_ARCHITECTURE.md "Session-scoped authorization").
 * `organizationId` here reflects the active session's organization, which
 * may differ from the user's home organization after
 * `switchOrganization()` — it is not simply `User.organizationId` echoed
 * back unmodified.
 */
export type SanitizedUser = Omit<PrismaUser, "passwordHash"> & {
  role: ResolvedRole;
};

export function sanitizeUser(user: PrismaUser, role: ResolvedRole): SanitizedUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return { ...rest, role };
}

/** One row of the "which organizations can this user act in" list surfaced by GET /auth/me. */
export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roleKey: string;
  roleName: string;
  isPrimary: boolean;
  isCurrent: boolean;
}
