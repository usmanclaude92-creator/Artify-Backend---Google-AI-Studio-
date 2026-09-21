# Session Security — Phase 3

## Storage
`sessions` table (Phase 2 schema, unchanged shape): `token_hash` (SHA-256 of the raw bearer token — never the raw token itself), `user_id`, `organization_id`, `expires_at`, `revoked_at`, `last_used_at`, `ip_address`, `user_agent`, `created_at`. The raw token exists only in the HTTP response body at issuance and in the client's own storage thereafter — never logged, never a second time queryable from the database.

## Lifecycle
| Event | Effect |
|---|---|
| Login | New session row, TTL = `config.sessionTtlHours` (default 24h) |
| Logout | That one session's `revoked_at` set |
| Logout-all | Every active session for the user revoked (`sessionRepository.revokeAllForUser`) |
| Change password | Every session **except** the one used to make the change is revoked (`revokeAllForUserExcept`) — the acting session is kept because it just proved fresh knowledge of the (now-previous) credential |
| Password reset confirm | **Every** session for the user is revoked — a reset implies the old credential may have been compromised, no exception |
| Membership suspended/removed | No explicit revocation call — `verifySession` re-checks live membership on every request, so a session bound to that organization stops working on its very next use, without collaterally revoking the user's sessions in unrelated organizations |
| Organization switch | Session **rotation**: a new token is issued for the target org, the old token is revoked in the same operation |
| User account disabled | Every session for that user is revoked immediately (`userService.updateUser`) |
| Expiry | `findValidByToken` treats `expires_at <= now()` identically to a nonexistent session — no separate "expired" state exposed to callers |

## Password reset tokens
Same hashing/storage discipline as sessions (`password_reset_tokens.token_hash`, SHA-256 — appropriate here because the token is generated server-side as high-entropy random data, not a low-entropy secret; see `server/utils/crypto.ts`'s doc comment on `hashToken`). Single-use (`used_at`), short TTL (`config.passwordResetTokenTtlMinutes`, default 30 min), and a fresh request invalidates any prior outstanding token for the same user (`passwordResetRepository.invalidateAllForUser`) — at most one usable reset credential exists at a time.

## Audit trail (every entry via the Phase 2 append-only `audit_logs`)
`AUTH_LOGIN`, `AUTH_LOGIN_FAILED`, `AUTH_ACCOUNT_LOCKED`, `AUTH_LOGOUT`, `AUTH_LOGOUT_ALL`, `AUTH_PASSWORD_CHANGE`, `AUTH_PASSWORD_RESET_REQUESTED`, `AUTH_PASSWORD_RESET_COMPLETED`, `AUTH_ORGANIZATION_SWITCH`. None of these ever write a plaintext password, raw session token, or raw reset token into `before_data`/`after_data`/`metadata` — only IDs, role keys, and organization IDs.

## What's verified by test (`tests/integration/passwordManagement.test.ts`, `tests/integration/organizationSwitching.test.ts`, `tests/security/authBypass.test.ts`)
- A session created directly in the database and looked up by raw token never matches — only by its SHA-256 hash.
- A revoked or expired session is rejected identically (401), including one tampered by flipping trailing characters.
- `logout-all` revokes the very session making the request, not just other sessions.
- `change-password` keeps the acting session valid while revoking a second, independent session for the same user.
- `password-reset/confirm` revokes a session that was active before the reset, and the reset token cannot be replayed.
- Suspending/removing an `OrganizationMembership` invalidates only sessions bound to that organization, leaving the user's other-org sessions intact.
