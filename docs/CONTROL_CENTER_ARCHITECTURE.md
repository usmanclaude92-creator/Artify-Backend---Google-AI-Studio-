# Control Center Architecture — Phase 4

## Where it lives
`Artify-Backend`'s own `src/` — the same repo as the Platform API, per `ADR-001-platform-boundary.md` and `docs/TARGET_ARCHITECTURE.md`'s "Control Center UI (Artify-Backend)". `artifysolscom` is the separate Public Website + Client Portal; its fabricated-auth removal is covered at the end of this document.

## Stack
React 19, Tailwind v4, no router/state-management library added — the previous ~10,000 lines of fabricated demo UI (`AdminDataContext.tsx`, 17 localStorage-backed "modules," `switchUserRole()`) were deleted outright rather than incrementally patched, since none of it could be made real without a backend capability behind it, and keeping it would mean continuing to present fabricated data as if authenticated. What replaced it:

```
src/context/AuthContext.tsx     the ONE authoritative auth state (§26)
src/context/ThemeContext.tsx    light/dark, localStorage (presentation only)
src/context/ToastContext.tsx    notification feedback
src/lib/apiClient.ts            fetch wrapper, envelope parsing, 401 hook (Phase 1, extended)
src/lib/api.ts                  typed request functions, one per Phase 3/4 endpoint
src/lib/permissions.ts          hasPermission() + extensible NAV_ITEMS config
src/lib/router.tsx              minimal History-API router (no new dependency)
src/components/auth/*           LoginPage, ForgotPasswordPage, ResetPasswordPage
src/components/layout/*         AppShell, Sidebar, Header (responsive, permission-aware nav)
src/components/modules/*        Dashboard, Users, Roles, Permissions, Organizations, AuditLog, Security, Settings
src/components/ui/ui.tsx        shared primitives (Card, Button, Modal, Pagination, EmptyState, …)
```

## Authentication integration
`Browser → AuthContext → apiClient (Bearer header) → Artify Platform API → RBAC → Prisma → PostgreSQL` — unchanged bearer-token architecture from Phase 3, no cookies introduced. Token stored in `sessionStorage` (not `localStorage`) — reduces the exposure window since no cookie-based mechanism exists yet; both are equally reachable by injected JS under XSS, a residual risk of any header-bearer-token SPA, stated here rather than hidden.

A synchronous `tokenRef` (not just React state) backs `apiClient`'s auth-token getter — state updates commit on the next render, so a naive `setState` + immediate authenticated request would race and 401 on the very request that follows a successful login. `AuthContext.login()`/`switchOrganization()` update the ref immediately, eliminating that race (found and fixed during this phase's own browser smoke test — see "Verification" below).

A global `unauthorizedHandler` (set once by `AuthContext`) fires on any 401 and clears auth state + shows a "session expired" banner — except for calls explicitly marked `suppressUnauthorizedHandling` (login, register, password-reset confirm), where a 401 means "wrong credentials," not "your session died."

## Permission-aware navigation
`src/lib/permissions.ts`'s `NAV_ITEMS` is a flat, extensible array — each entry pairs a nav label with an optional `requiresAnyPermission` list and a page component. Future product modules (CRM, Products, CMS, Media, Subscriptions, Billing, Reports, AI — explicitly not built this phase) register the same way, not via a hardcoded switch. **UI-only**: hiding a nav item or button never substitutes for backend authorization (§27/§28) — every mutation in every module still calls a route protected by `requirePermission`/`requireRole` server-side; `tests/security/authBypass.test.ts` proves this at the API layer directly, independent of what the frontend renders.

## Protected routes / session expiry
`AppShell` checks `item.requiresAnyPermission` against `user.role.permissions` and renders `AccessDenied` (not a silent redirect) when absent. `App.tsx`'s top-level effect redirects unauthenticated users to `/login` and authenticated users away from auth pages. A 401 anywhere clears state and returns to `/login` with a concise, non-technical banner — never a raw backend error.

## Organization switching
`Header`'s org switcher calls `AuthContext.switchOrganization()` → `POST /auth/switch-organization` (Phase 3) → backend re-verifies membership and rotates the session token → the new `SanitizedUser`'s `role.permissions` (recalculated for the target org) replace the old ones, and `visibleNavItems()` re-evaluates on the next render. Nothing is switched by local state alone.

## Backend additions this phase (`server/routes/v1/`)
None of these existed before Phase 4; all reuse Phase 2 schema (no migration needed except `password_reset_tokens` in Phase 3):
- `GET /organizations/:id/members` — paginated member listing (mutation endpoints already existed).
- `GET /organizations/:id/summary` — real `memberCount`/`activeSessionCount` for the dashboard, no fabricated metrics.
- `GET /audit-logs` — paginated, filterable (action/resourceType/result/date range), tenant-scoped; read-only (`auditLogQueryRepository.ts`, a companion to `auditLogRepository.ts` kept deliberately separate so the latter's append-only invariant — asserted by `Object.keys(auditLogRepository) === ["record"]` in `tests/security/rbacAndAudit.test.ts` — is untouched).
- `GET /auth/sessions`, `POST /auth/sessions/:id/revoke` — self-service only, never another user's session, never a token hash in the response.
- `GET /settings`, `PATCH /settings/:key` — thin CRUD over Phase 2's `system_settings` table; no setting exists that the backend doesn't genuinely persist.

## Verification
Real browser smoke test (Playwright, Chromium) against the actual running app + real Postgres: register → login → Dashboard renders real counts → Users page shows the real registered user → Audit Log shows the real `AUTH_LOGIN` events → theme toggle → mobile viewport (390px) renders without page-level horizontal scroll. Screenshots taken at each step. This is in addition to, not instead of, the automated test suites (`docs/PHASE_4_COMPLETION_REPORT.md` has exact counts).

## artifysolscom (Client Portal) fabricated-auth removal
`src/context/AuthContext.tsx`'s `login()`/`register()` now call the real Platform API (`POST /auth/login`, `POST /auth/register`) and throw on failure — no password is accepted without a real bcrypt-verified match. Removed entirely: `loginAsDemo()`, the `demoKey` parameter, the email-matches-a-demo-account auto-login path, the login form's "Auto-fill demo credentials" button, and `AuthModal`'s/`CreateArticleModal`'s three "1-Click Demo Profile" / "1-Click Editor Demo" buttons (the direct equivalent of "Login as Admin"). "Forgot password?" now calls the real `POST /auth/password-reset/request` instead of an `alert()`. The signup form gained a required password field (real registration needs one).

**What remains explicitly out of scope, not silently fabricated as new**: once a real login succeeds, the portal's subscription/product/invoice/API-key screens still render local placeholder business data — the Platform API's CRM/Products/Commercial domains are schema-only (Phase 2) with no service/route layer yet, and building that is Billing/Products/CRM work the brief explicitly excludes from Phase 4. The UI's own "Demo Account" label was rewritten to say this precisely (`ClientPortal.tsx`) rather than continue claiming "accepts any email as a demo login," which stopped being true.
