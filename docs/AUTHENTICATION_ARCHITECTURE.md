# Authentication Architecture — Phase 3

## Flow
```
Browser → Artify Platform API (/api/v1) → auth middleware → session/token validation
        → user lookup → organization membership → role/permission resolution → route
```
The browser never queries Postgres directly, never holds Supabase credentials — only a bearer session token (`server/middleware/auth.ts`).

## Credential model
- **Bearer tokens, not cookies.** `Authorization: Bearer art_sess_<64 hex chars>` — unchanged from Phase 1. No cookie-based session was introduced this phase; see "CSRF" below for why.
- **Passwords**: bcryptjs, cost 12 (`server/utils/password.ts`) — unchanged from Phase 1, still the right choice (dependency-free of a native toolchain across deploy targets; Argon2id was evaluated and not adopted — no concrete deployment need justified the migration risk this phase). Policy: minimum length from `config.passwordMinLength` (default 10), rejects purely-numeric and a small known-weak set (`validatePasswordPolicy`).
- **Session tokens**: `art_sess_<32 random bytes>`, stored only as a SHA-256 hash (`sessions.token_hash`) — unchanged from Phase 2. TTL centralized (`config.sessionTtlHours`, default 24h).
- **Password reset tokens**: `art_reset_<32 random bytes>`, stored only as a SHA-256 hash (`password_reset_tokens.token_hash`), single-use, TTL centralized (`config.passwordResetTokenTtlMinutes`, default 30 min). A fresh request invalidates any prior outstanding token for the same user.

## Session-scoped authorization (the Phase 3 architecture change)
Phase 2 resolved a session's role from `User.roleId` — a single, global "home role." Phase 3 replaces this: **every session's role is resolved from the `OrganizationMembership` row matching that session's `organizationId`**, not from the user directly (`server/services/authService.ts`'s `resolveSanitizedUserForOrganization`). Consequences:
- `verifySession()` re-checks live membership status on **every request** — if an admin revokes a user's membership (or suspends the organization) after a session was issued, that session stops granting access on its very next use, without needing to explicitly hunt down and revoke it.
- A user's permissions always reflect their role **in the organization the current session is bound to**, never a stale or unrelated org's role.
- `User.roleId`/`User.organizationId` remain on the row (home org, set at registration) for backward compatibility and as the default login target, but are no longer the source of truth for authorization once a session exists.

## Organization switching
`POST /api/v1/auth/switch-organization` — verifies the caller holds an ACTIVE membership in the target organization (and that organization is ACTIVE/TRIAL, not SUSPENDED/ARCHIVED), then **rotates** the session: issues a brand-new token for the target org and revokes the old one, rather than mutating a session in place. Permissions are recalculated from scratch for the new org — never carried over. Audited as `AUTH_ORGANIZATION_SWITCH`. `GET /auth/me` returns the full list of organizations the caller can switch into (`organizations: MembershipSummary[]`).

## Account lockout / brute-force defense
Centralized in `server/config/env.ts`, never hard-coded: `ACCOUNT_LOCKOUT_THRESHOLD` (default 5), `ACCOUNT_LOCKOUT_DURATION_MINUTES` (default 15). Enforced in `userRepository.recordFailedLogin`. Layered with rate limiting (`server/middleware/rateLimiter.ts`): `authLimiter` (login/register, 10/15min keyed by IP+email), `passwordResetLimiter` (5/hour keyed by IP+email), `sensitiveActionLimiter` (change-password/switch-org, 20/15min keyed by caller).

## Password reset (Phase 13 boundary)
No email provider exists yet (Phase 13). `requestPasswordReset` always returns a generic `{message}` response regardless of whether the account exists (enumeration hardening) and, **only outside production** (`!config.isProduction`), also returns `devToken` — the raw token, for local/CI testing of the full flow without a real inbox. In production this field is always absent; the raw token is never logged (`logger` calls throughout only ever reference the row, never the token) and never persisted anywhere except as a hash. Phase 13 integration point: replace the `devToken` return with an actual email send in `authService.requestPasswordReset`.

## CSRF / cookies
No cookie-based session was introduced. The API remains bearer-token-only (`Authorization` header), which a browser never sends automatically — so there is no ambient credential for a third-party site to ride on, and CSRF tokens are not applicable to this architecture (same reasoning as `docs/SECURITY_MODEL.md` finding S11). If a future phase moves the browser apps to a cookie-based session for XSS-hardening reasons, that phase must add CSRF protection at the same time — tracked, not silently deferred.

## Error semantics
Unchanged, applied consistently to every new Phase 3 route: unauthenticated → 401, authenticated-but-forbidden → 403, missing/cross-tenant resource → 404 (never a distinguishing 403 that would leak cross-org existence — see `docs/RBAC_IMPLEMENTATION.md`), validation → 400, rate-limited → 429. Centralized in `server/middleware/errorHandler.ts`; no route constructs its own error response.
