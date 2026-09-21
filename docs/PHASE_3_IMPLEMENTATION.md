# Phase 3 — Production Authentication, Identity & RBAC

Implementation notes for Phase 3, scoped exactly to the brief: authentication, session security, and operational RBAC over the Phase 2 schema — no CRM/CMS/billing/Control Center UI. See `docs/PHASE_3_COMPLETION_REPORT.md` for status, `docs/AUTHENTICATION_ARCHITECTURE.md`/`docs/RBAC_IMPLEMENTATION.md`/`docs/SESSION_SECURITY.md` for the architecture.

## What changed, and why

### 1. Schema
One additive migration (`20260921000001_phase3_auth_rbac`): a single new table, `password_reset_tokens` (hashed token, single-use, short TTL, `onDelete: Cascade` from `users` — a reset token has no meaning once its user is gone). No column/type change to any existing table. Verified both as an upgrade from the Phase 2 state and from a clean database.

### 2. Session-scoped role resolution (the core architecture change — `ADR-016`)
Phase 2 left a documented gap: sessions resolved role from `User.roleId` (a single global role), not from the real multi-org `OrganizationMembership` model. Phase 3 closes it: `authService`'s `resolveSanitizedUserForOrganization(user, organizationId)` is now the single path every login/session-verification/org-switch call goes through, resolving role from the membership matching the session's own organization. This makes `verifySession()` re-check live membership on every request — a revoked membership invalidates its sessions immediately, not just at next login.

### 3. Ported vs. built new
- **Ported near-verbatim** (Phase 1/2 design was sound): `authenticateToken`/`requirePermission`/`requireRole`/`enforceTenantIsolation`/`enforceRecordOwnership` middleware, the `apiResponse` envelope, bcrypt password hashing, session token hashing.
- **Extended**: `authService` (change-password, password-reset request/confirm, logout-all, switch-organization), `sessionRepository` (`revokeAllForUserExcept`), `userRepository` (profile/status/password updates, config-driven lockout), `roleRepository` (`listAllResolved`).
- **Built new**: `organizationMembershipRepository`, `passwordResetRepository`, `userService`, `organizationService`, the `/users`, `/roles`, `/permissions`, `/organizations` route groups, the full password-policy/schema layer (`server/schemas/userSchemas.ts`), five new centralized config values (`server/config/env.ts`).

### 4. Permission catalog additions
`roles.read/create/update/delete/assign` and `organizations.manage_members` — genuinely new capabilities this phase introduces (role assignment, membership management), not present in Phase 2's catalog. Everything else in the brief's §15 list already existed from Phase 2 and was left as-is (no risk-free benefit to renaming e.g. `subscriptions.manage` → `subscriptions.create/update/cancel` when no subscription route exists yet to consume the distinction).

### 5. Role-assignment protections (§19, enforced in `userService`/`organizationService`, not just the route layer)
- `SUPER_ADMIN` is never an assignable value on any role-mutating endpoint — rejected by zod schema (`assignableRoleKeySchema`) before the service layer runs.
- Changing a `roleKey` additionally requires `roles.assign`, even when the caller already holds `users.update`/`organizations.manage_members` — role assignment is a distinct privilege.
- A caller can never change their own role, unconditionally, including SUPER_ADMIN — blocks the simplest form of self-escalation outright rather than relying on permission checks alone.
- A user/organization outside the caller's own organization returns 404, not 403 — never confirms cross-tenant existence.

### 6. Password reset without an email provider (§12, Phase 13 boundary)
`requestPasswordReset` always returns the same generic message regardless of account existence. Outside production only, it additionally returns the raw token (`devToken`) so the full flow is testable without a real inbox; in production this field never appears, the token is never logged, and is persisted only as a hash. The email-send call is the explicit Phase 13 integration point, documented inline in `authService.ts`.

### 7. Deliberate Phase 3 scope boundaries
No CRM/CMS/billing/product route or service was touched. No Control Center UI work beyond the two frontend items in §8. No custom-role feature (roles remain the five Phase 2 system roles). No cookie-based session or CSRF machinery was introduced — the bearer-token architecture was kept and the reasoning documented (`docs/AUTHENTICATION_ARCHITECTURE.md` "CSRF / cookies"), not silently ignored.

### 8. Frontend (§29)
No broad frontend redesign. Full Control Center UI rewiring (`Artify-Backend/src/context/AdminDataContext.tsx`'s `switchUserRole` and its ~6 consumers, `artifysolscom/src/context/AuthContext.tsx`'s fabricated login/register and the entire client-portal/admin-console UI built on that fabricated state) is explicitly out of scope this phase (§29: "Do not start Control Center UI implementation beyond what is required for authentication") — that fabricated demo state remains, unchanged from Phase 1's "Demo Data" labeling, and is called out honestly as a known, pre-existing risk in the completion report rather than silently left unmentioned. The real backend API this document describes is what a future, explicitly-scoped frontend phase wires up to.

## Config additions (`server/config/env.ts`, all with sensible defaults — no `.env` changes required)
`SESSION_TTL_HOURS` (24), `ACCOUNT_LOCKOUT_THRESHOLD` (5), `ACCOUNT_LOCKOUT_DURATION_MINUTES` (15), `PASSWORD_RESET_TOKEN_TTL_MINUTES` (30), `PASSWORD_MIN_LENGTH` (10).
