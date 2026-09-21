# Authorization / RBAC Audit & Target Model

> **Phase 2 update**: §4's target model is now substantially implemented. Item 1 (port `authService` middleware) and item 4 (bcrypt) were done in Phase 1. Item 5 (persist roles/permissions in a real `role_permissions` join table, editable rather than a flat per-user array) is now done — `roles`/`permissions`/`role_permissions` are real tables (`ADR-011`), resolved at read time via `roleRepository.resolveById()`, seeded via `prisma/rolePermissionSeed.ts`. `req.user.role` is now `{id, key, name, permissions: string[]}` (`server/types/domain.ts`'s `ResolvedRole`), not a flat array. The role set itself was also redefined (not "ported as-is"): Phase 0/1's 13-role enum was replaced with five: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`, `VIEWER` (`ADR-011`) — a deliberate simplification per the Phase 2 brief, not an oversight. `companyId` → `organizationId` throughout (`ADR-010`). Item 3 (tenant isolation on every ID-taking route) and the `enforceRecordOwnership` factory from item 2 exist in `server/middleware/auth.ts` and are proven at the query layer by `tests/security/rbacAndAudit.test.ts`'s direct-query isolation test; a full route-by-route audit of every CRM/CMS/Commercial route (§3.1) is not yet applicable since those routes don't exist yet (schema only — `docs/DATABASE_SCHEMA.md`). Item 6 (remove `switchUserRole()`/fabricated portal login) remains Phase 3 frontend work, unchanged by Phase 2. See `docs/PHASE_2_COMPLETION_REPORT.md`.

## 1. Current state — three different authorization realities

| Layer | Enforcement | Evidence |
|---|---|---|
| `artify-backend` admin console | **None.** UI-only `rbacMatrix` decides what renders; `switchUserRole()` lets a browser become any role with zero server check | `AdminDataContext.tsx:174,480-493`; no auth middleware exists in `artify-backend/server.ts` |
| `artifysolscom` Client Portal (as actually used) | **None.** No server round-trip at all for auth | `AuthContext.tsx:117-134` |
| `artifysolscom/server/` real backend (unused by UI) | **Real**, and reasonably well designed | `authService.ts:235-367` |

## 2. What the unused real backend gets right (reuse it)
- `authenticateToken` — verifies Bearer session token, rejects missing/expired.
- `requirePermission(permission)` — checks `req.user.permissions.includes(permission)`, with an explicit `Super Administrator` bypass.
- `requireRole(allowedRoles)` — role allow-list, same bypass.
- `enforceTenantIsolation` — rejects a request whose `companyId` (param/query/body) doesn't match the caller's own, again with a `Super Administrator` bypass.
- 30+ granular `PermissionKey`s already modeled (`server/types/index.ts:21-56`), matching real product areas (cms, blog, customers, products, subscriptions, leads, ai.agents, ai.tasks, notifications, audit, settings, company).

This is a legitimate RBAC skeleton for a prototype and should be **ported, not rebuilt**, into the target platform.

## 3. What's missing before it can be called "production RBAC"

### 3.1 Horizontal privilege escalation — CONFIRMED GAP
`requirePermission`/`requireRole` confirm the caller holds a permission *somewhere*; several routes never additionally verify the **specific record** belongs to the caller:
- `PUT /api/v1/cms/articles/:id` — no check that the article's `companyId` matches the caller's.
- `POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/:id` — `subscriptionService.revokeApiKey` does filter by `companyId` internally (good), but `createApiKey`'s uniqueness/ownership isn't re-validated against `req.params`.
- `POST /api/v1/notifications/:id/read` — no ownership check against `req.user.id`/`companyId` at all; any authenticated user can mark any other tenant's notification read.
- `PUT /api/v1/ai/coworkers/:id` — no `companyId` check before update.

**Concrete exploit scenario**: Company A's Content Manager (has `blog.update`) sends `PUT /api/v1/cms/articles/<Company B's article id>` with a crafted body — the permission check passes because the permission is role-level, not resource-level, and the handler updates the record regardless of which tenant owns it.

**Fix**: every single-record mutation route must load the record first, then compare `record.companyId === req.user.companyId` (or call `enforceTenantIsolation`-equivalent logic) before applying the update — not just check the caller's blanket permission.

### 3.2 Vertical privilege escalation
Not currently exploitable *in the real backend* — every mutating route does call `requirePermission`/`requireRole` before the handler runs. The vertical-escalation risk is entirely in the **other two layers** (§1): the admin console's `switchUserRole()` and the portal's fabricated login are, by construction, 100% vertical privilege escalation — any visitor can be Super Administrator by calling a client-side function.

### 3.3 Tenant isolation
`enforceTenantIsolation` exists and works for the routes that call it, but it is **not applied consistently** — most `server/routes/v1/*` handlers rely on `req.user.companyId` inside the service call rather than the shared middleware, meaning the isolation logic is duplicated ad-hoc per-service instead of centrally guaranteed. A future service that forgets the check has no safety net.

### 3.4 No real backing store
None of the above matters yet in practice because nothing is persisted (`CURRENT_STATE.md` §3) — but the design must be validated now, before a real DB makes exploitation real.

## 4. Target model
1. **Port** `server/services/authService.ts`'s middleware set into the platform API essentially as-is.
2. **Add** a resource-loader-then-compare pattern as a reusable Express middleware factory: `enforceRecordOwnership(loadFn: (id) => Promise<{companyId}>)`, applied to every route identified in §3.1.
3. **Apply** `enforceTenantIsolation` (or the new ownership middleware) on literally every route that takes a record ID, not opportunistically.
4. **Replace** unsalted SHA-256 password hashing with bcrypt/argon2 (see `SECURITY_MODEL.md`).
5. **Persist** roles/permissions in `role_permissions` join table so permission sets are editable by Super Administrators through the Control Center UI rather than hardcoded per-user arrays (today `User.permissions` is a flat array set at creation time — no central role definition to edit).
6. **Remove** `switchUserRole()` and the fabricated portal `login()`/`register()` entirely in Phase 3 — no "keep as a dev toggle" exception, since it's reachable in the production bundle today.
