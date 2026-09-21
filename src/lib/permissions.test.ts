/**
 * Phase 4 §33/§34 — permission-aware navigation is UX only, but it must
 * still correctly reflect the backend permission set, and it must be
 * IMPOSSIBLE for it to grant visibility (let alone access — enforced
 * server-side, see tests/security/authBypass.test.ts in server/) based on
 * anything other than the real `role.permissions` array from the API.
 */
import { describe, expect, it } from "vitest";
import { hasPermission, visibleNavItems, NAV_ITEMS } from "./permissions";

describe("hasPermission", () => {
  it("returns true only when the exact key is present", () => {
    expect(hasPermission(["users.read", "audit.read"], "users.read")).toBe(true);
    expect(hasPermission(["users.read"], "users.delete")).toBe(false);
  });

  it("returns false for undefined/empty permissions (never fails open)", () => {
    expect(hasPermission(undefined, "users.read")).toBe(false);
    expect(hasPermission([], "users.read")).toBe(false);
  });
});

describe("visibleNavItems", () => {
  it("always includes Dashboard, which requires no permission", () => {
    const items = visibleNavItems([]);
    expect(items.map((i) => i.id)).toContain("dashboard");
  });

  it("hides permission-gated items when the permission is absent", () => {
    const items = visibleNavItems([]);
    expect(items.map((i) => i.id)).not.toContain("users");
    expect(items.map((i) => i.id)).not.toContain("organizations");
  });

  it("shows an item once its required permission is present", () => {
    const items = visibleNavItems(["users.read"]);
    expect(items.map((i) => i.id)).toContain("users");
  });

  it("every gated nav item's permission is a real key in the Phase 3 catalog shape (dot-namespaced, module segment may be snake_case — e.g. Phase 7's product_modules.*; Phase 10's portal.* nests a further segment, e.g. portal.dashboard.read)", () => {
    for (const item of NAV_ITEMS) {
      for (const perm of item.requiresAnyPermission ?? []) {
        expect(perm).toMatch(/^[a-z]+(_[a-z]+)*(\.[a-z_]+)+$/);
      }
    }
  });

  it("no nav item is gated by a role check (e.g. 'SUPER_ADMIN') instead of a permission — §7", () => {
    for (const item of NAV_ITEMS) {
      for (const perm of item.requiresAnyPermission ?? []) {
        expect(perm).not.toMatch(/ADMIN|SUPER/i);
      }
    }
  });
});
