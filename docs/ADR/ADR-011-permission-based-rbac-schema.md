# ADR-011: Permission-Based RBAC Schema

## Status
Accepted (Phase 2 — resolves the deferral noted in `docs/DATABASE_DESIGN.md`'s Phase 1 scoping note and `prisma/schema.prisma`'s Phase 1 `User.permissions` comment)

## Context
Phase 1 modeled `role` as a Prisma enum (13 granular Phase-0-inherited role names) and `permissions` as a flat `String[]` column directly on `User`, explicitly deferring the normalized structure. The Phase 2 brief requires real `roles`/`permissions`/`role_permissions` tables, a specific smaller role set (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`, `VIEWER`), and states plainly: "Do not blindly preserve prototype role names."

## Decision
1. **`roles`** (`id`, `key`, `name`, `description`, `is_system`) — 5 seeded system roles (`prisma/rolePermissionSeed.ts`), replacing the Phase 0/1 role names entirely, not extending them.
2. **`permissions`** (`id`, `key`, `name`, `description`, `module`) — ~40 permissions, namespaced `<module>.<action>` (`users.read`, `content.publish`, `ai.manage`, ...), covering the security boundaries the brief lists (§16), not an exhaustive enumeration of every possible future action.
3. **`role_permissions`** — the join table, unique on `(role_id, permission_id)`, `ON DELETE CASCADE` on both sides (deleting a role or permission cleans up its mappings — this is safe because `role_permissions` rows carry no independent meaning, unlike business data).
4. **`users.role_id`** replaces `users.role` (enum) + `users.permissions` (array) — a permission check now resolves the caller's full permission set via `role_permissions` at session-verification time (`server/repositories/roleRepository.ts#resolveById`), never stored redundantly per-user.
5. `Super Administrator` role retains the middleware fast-path bypass it had in Phase 1 (`req.user.role.key === "SUPER_ADMIN"` skips the permission check) **and** is seeded with every permission in `role_permissions` — the bypass is a performance/simplicity shortcut, not the source of truth; a report or audit query against `role_permissions` for `SUPER_ADMIN` returns the real, complete grant.

## Consequences
- Changing what a role can do is a data change (`role_permissions` rows), not a code deploy — proven by `tests/security/rbacAndAudit.test.ts`'s "changing role_permissions changes what resolveById returns" test.
- `server/middleware/auth.ts`'s `requirePermission`/`requireRole` now check `req.user.role.permissions`/`req.user.role.key` (resolved at auth time) instead of a per-user array — the middleware's external behavior/API is otherwise unchanged from Phase 1.
- A future custom-roles feature (letting an organization define its own role beyond the 5 system roles) is enabled by this schema (`roles.is_system = false` for a custom row) but is **not built** in Phase 2 — no UI or API route creates non-system roles yet.

## Alternatives considered
- Keeping Phase 0/1's 13-role enum and just adding `role_permissions` on top of it: rejected — the brief explicitly asks for the smaller `SUPER_ADMIN`/`ADMIN`/`MANAGER`/`USER`/`VIEWER` set, and the finer-grained Phase 0 role names (Content Manager, Finance Manager, etc.) don't map cleanly onto "a role is a permission set" without becoming permission *combinations* better expressed as actual permission grants than as more roles.
- Storing permissions as a JSONB array on `roles` instead of a join table: rejected — a join table gets real FK integrity (`ON DELETE CASCADE`, no orphaned permission keys) and is queryable both directions (which roles grant X permission) without JSON operators.

## Related decision folded into this ADR: session tokens are hashed at rest
Phase 2 §18 requires session tokens not be stored raw where a hash suffices. `sessions.token_hash` (unique, indexed) replaces Phase 1's raw `sessions.token` primary key — `server/utils/crypto.ts#hashToken` computes a plain SHA-256 over the incoming bearer token before every read/write. This is deliberately a *fast*, unsalted hash, unlike password hashing: the input is already a 256-bit cryptographically random value (`generateSessionToken()`), not a low-entropy secret, so there is nothing for a fast hash to make brute-forceable — the same reasoning GitHub/Auth0 apply to API token storage. Verified by `tests/integration/auth.test.ts`'s session-lookup test (looks up by re-hashing the raw token, proving the raw value is never persisted anywhere queryable) and `tests/security/rbacAndAudit.test.ts`'s expiry/revocation tests.
