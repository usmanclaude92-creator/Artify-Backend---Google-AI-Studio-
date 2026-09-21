# RBAC Implementation — Phase 3

Phase 2 introduced `roles`/`permissions`/`role_permissions` as schema. Phase 3 makes them operational: real management routes, role-assignment protections, and a controlled permission catalog.

## Resolution chain
```
Role → RolePermission → Permission
```
Resolved at read time (`roleRepository.resolveById`/`listAllResolved`), never cached or hardcoded per-user. `tests/security/rbacAndAudit.test.ts` proves this by inserting a new permission grant directly and showing the next resolution picks it up with no code change.

## Centralized enforcement
Every privileged route uses one of `server/middleware/auth.ts`'s functions — no controller hand-rolls an authorization check:
- `requirePermission("users.read")` — data-driven permission check (SUPER_ADMIN bypasses).
- `requireRole(["SUPER_ADMIN"])` — role allow-list.
- `enforceTenantIsolation` / `enforceRecordOwnership(loadFn)` — per-record tenant scoping.

## Permission catalog (Phase 3 additions in **bold**)
`users.*`, `organizations.read/create/update/delete`, **`organizations.manage_members`**, **`roles.read/create/update/delete/assign`**, `clients.*`, `leads.*`, `products.*`, `content.*`, `media.*`, `subscriptions.read/manage`, `billing.read/manage`, `reports.*`, `settings.*`, `audit.read`, `ai.use/manage` — full list in `server/types/domain.ts`'s `PERMISSION_KEYS`, seeded via `prisma/rolePermissionSeed.ts`. Not created speculatively: no permission exists for a module that has no schema/design behind it yet.

## System roles vs. organization roles
Five system roles, unchanged set from Phase 2, seeded with `isSystem: true`: `SUPER_ADMIN` (platform-level, every permission, seed/bootstrap-only — never assignable through any API route), `ADMIN`/`MANAGER`/`USER`/`VIEWER` (organization-level, assignable within an org by someone holding `roles.assign`). No custom-role feature exists (would be real, separately-scoped work — not built speculatively).

**No path grants privileged access via the client**: role/permissions are resolved server-side from the database on every request (`authService.verifySession`), never trusted from a JWT payload, request field, or organization ID the browser supplies. Concretely blocked:
- `assignableRoleKeySchema` (zod) rejects `SUPER_ADMIN` as a role value on every user/membership-mutating endpoint — a 400 before the service layer is even reached.
- `userService.updateUser`/`organizationService.updateMember` re-check `roles.assign` even when the general `users.update`/`organizations.manage_members` permission is present — role assignment is a distinct privilege.
- A caller can never change their own role via `PATCH /users/:id` or `PATCH /organizations/:id/members/:userId` — blocked unconditionally, including for SUPER_ADMIN (`tests/integration/userManagement.test.ts`).
- Changing `organizationId`/user id in a request body never redirects a privileged action to another tenant — every service ignores caller-supplied tenant/user identifiers where the caller's own session context is authoritative (`tests/security/authBypass.test.ts`).

## Tenant-scoped 404, not 403
A user/organization outside the caller's own organization returns **404 NotFoundError**, not 403 — a 403 would confirm the record exists in someone else's tenant. See `userService.ts`'s `loadUserInOrgOrThrow` and `tests/integration/userManagement.test.ts`'s "no cross-org existence leak" test.

## Endpoints (all under `/api/v1`, all `authenticateToken` + `requirePermission`)
```
GET    /users                       users.read   (org-scoped; SUPER_ADMIN may pass ?organizationId=)
GET    /users/:id                   users.read
POST   /users                       users.create (creates in caller's session org only)
PATCH  /users/:id                   users.update (+ roles.assign if roleKey present)
GET    /roles                       roles.read
GET    /permissions                 roles.read
GET    /organizations               organizations.read
GET    /organizations/:id           organizations.read
POST   /organizations/:id/members   organizations.manage_members
PATCH  /organizations/:id/members/:userId   organizations.manage_members (+ roles.assign if roleKey present)
DELETE /organizations/:id/members/:userId   organizations.manage_members
```

## Audit coverage
Every mutation above writes an `audit_logs` row via the existing append-only `auditLogRepository.record` (Phase 2, unchanged): `USER_CREATED`, `USER_UPDATED`, `USER_STATUS_CHANGED`, `USER_ROLE_CHANGED`, `ORG_MEMBERSHIP_ADDED`, `ORG_MEMBERSHIP_UPDATED`, `ORG_MEMBERSHIP_REMOVED`, plus the auth-flow actions in `docs/SESSION_SECURITY.md`.
