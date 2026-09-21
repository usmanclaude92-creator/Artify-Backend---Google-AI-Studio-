# ADR-003: Authentication — Bearer Session Tokens + bcrypt/argon2

## Status
Accepted (Phase 0); implemented in the identity foundation (Phase 1)

## Context
Three authentication realities exist today (`CURRENT_STATE.md` §1.3, §2.3, §2.4): two are complete fabrications reachable from the browser (critical findings S1/S2 in `SECURITY_MODEL.md`), one (`artifysolscom/server/services/authService.ts`) is a real, reasonably designed bearer-token session system undermined only by unsalted SHA-256 password hashing and zero persistence.

## Decision
Keep the existing bearer-token session shape (`art_sess_<32 random bytes>`, `Authorization: Bearer <token>`, server-side session store with TTL and revocation) — it already works and required no redesign. Replace `crypto.createHash('sha256')` password hashing with bcrypt (cost ≥ 12) or argon2id. Add rate limiting on login/register, password reset, and refresh-token rotation on top of the existing design. Remove every client-side-fabricated login/role path (`AuthContext.login`, `AdminDataContext.switchUserRole`) once the real API is wired (Phase 3-4).

**Phase 1 resolution: `bcryptjs` (cost 12), not native `bcrypt` or argon2id.** `bcryptjs` is a pure-JS bcrypt implementation with no native-addon build step, which matters because the deploy targets already in use (`Dockerfile`, Vercel serverless via `api/index.ts` in `artifysolscom`) shouldn't depend on a working native-compilation toolchain at install time just for password hashing. This is a portability choice, not a rejection of argon2id's stronger memory-hardness guarantees — worth revisiting under Phase 15's security hardening pass if bcrypt's GPU-crackability becomes a real threat model concern at scale. Rate limiting (10 attempts/15min per IP+email), account lockout after 5 failed attempts (15min), and session revocation are implemented; password reset and refresh-token rotation remain Phase 3 work — the foundation (hashing, sessions, lockout) is real, but those two flows are not yet built.

## Consequences
- Minimal rework of the already-sound `authService` middleware chain (`authenticateToken`, `requirePermission`, `requireRole`, `enforceTenantIsolation`) — ported near-verbatim.
- Every seed/demo password in `db.ts` must be regenerated through the new hashing function before any real deployment; the current plaintext-looking demo passwords in source (`db.ts:136,152,181`) never reach a real environment.
- Session storage moves from an in-memory `Map` to Postgres (or Redis, if session volume later justifies a separate fast store — not needed at current scale).

## Alternatives considered
- JWT (stateless, self-contained tokens): rejected for now — the existing design's server-side revocable session list is simpler to reason about for admin-forced logout/session-kill scenarios (a real requirement for a Super Administrator managing compromised accounts), and token volume doesn't yet justify JWT's statelessness benefit.
- OAuth/SSO (Google/Microsoft login): out of scope for Phase 3, worth revisiting once real enterprise customers request it — the current email/password design does not block adding it later as an additional login method.
