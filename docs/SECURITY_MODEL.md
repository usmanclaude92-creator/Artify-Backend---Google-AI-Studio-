# Security Audit & Target Security Architecture

> **Phase 2 update**: S5 (unsalted SHA-256 passwords) was fixed in Phase 1 (bcrypt) and remains so. Phase 2 added one further Identity-layer hardening beyond this doc's original scope: session tokens are now stored as `sessions.token_hash` (SHA-256 of the token — a deliberately different, faster hash than password hashing since the input is already 256-bit random, see `ADR-011`'s session addendum), never the raw token, so a leaked `sessions` table row no longer yields a usable bearer token. S7 (horizontal privilege escalation) is fixed for the Identity domain via `enforceRecordOwnership`/tenant-scoped repository queries (`AUTHORIZATION_MODEL.md`'s Phase 2 update, `tests/security/rbacAndAudit.test.ts`); CRM/CMS/Commercial routes referenced in the original S7 finding still don't exist (schema only), so that specific finding is not yet re-testable end-to-end. New Phase 2 principle not in the original findings list: every tenant-owned table has a NOT NULL `organization_id` with `RESTRICT` (not `CASCADE`) on delete by default, so a user deletion can never cascade-destroy audit/financial history (`docs/DATABASE_SCHEMA.md`'s deletion-policy table, `ADR-010`). Row Level Security was evaluated and deliberately not enabled — the backend-authorization-boundary model above is the sole enforcement layer (`ADR-015`). See `docs/PHASE_2_COMPLETION_REPORT.md`.

## 1. Findings (current state, classified by severity)

| # | Finding | File / evidence | Impact | Blocks production? |
|---|---|---|---|---|
| S1 | CRITICAL | Client-side auth fabrication: any credentials "log in" as a fully-privileged fabricated user | `artifysolscom/src/context/AuthContext.tsx:117-134` | Anyone can present as any customer with any subscription/invoices; no real gate exists | Yes |
| S2 | CRITICAL | Client-controlled RBAC / instant role switch, no server check | `artify-backend/src/context/AdminDataContext.tsx:174,480-493`; no auth middleware in `artify-backend/server.ts` | Any browser session can act as Super Administrator in the admin console | Yes |
| S3 | CRITICAL | Webhook "signature" verification passes when the signature header is simply omitted | `artify-backend/server.ts:423-430` | Forged leads can be injected into CRM/auto-triage undetected | Yes |
| S4 | HIGH | Webhook secret hardcoded with a real-looking default and duplicated in the client bundle | `artify-backend/server.ts:190`; `.env.example`; `AdminDataContext.tsx:607` | Secret is not a secret — shipped to every browser | Yes |
| S5 | HIGH | Password hashing is unsalted SHA-256 | `artifysolscom/server/core/db.ts:47-49` | Fast-hash + no salt = trivial rainbow-table/brute-force once real users exist | Yes |
| S6 | HIGH | No CORS policy, no rate limiting, no Helmet-equivalent (only 3 headers set) on any Express app | `artifysolscom/server.ts:27-32` (partial), `artify-backend/server.ts` (none) | Any origin can call the API; brute-force/credential-stuffing/DoS have no friction | Yes |
| S7 | HIGH | Horizontal privilege escalation on several `server/v1` mutation routes (no per-record tenant check) | See `AUTHORIZATION_MODEL.md` §3.1 | Cross-tenant data tampering once persisted | Yes |
| S8 | MEDIUM | PII (name, company, email) logged to stdout unredacted on every lead submission | `artifysolscom/server.ts:177`, `api/index.ts:151` | Log-storage compliance exposure (GDPR-adjacent) once logs are centrally collected | Should fix pre-launch |
| S9 | MEDIUM | Health/status endpoints report fabricated or unverified state | `artify-backend/server.ts:66` (`database: connected` with no DB); `artify-backend/server.ts` system stats | Misleads on-call/monitoring into believing the system is healthy | Should fix pre-launch |
| S10 | MEDIUM | No input validation library anywhere — only ad-hoc null checks | All route handlers in both repos | Malformed/oversized payloads reach services unchecked; type confusion possible | Should fix pre-launch |
| S11 | MEDIUM | No CSRF protection | Both repos — session is Bearer-token based today (not cookie), so CSRF risk is currently low, but any future cookie-based session needs explicit CSRF tokens | Latent — becomes real if sessions move to cookies | Track for Phase 3 |
| S12 | LOW | No dependency vulnerability scanning configured (no `npm audit`/Dependabot/Snyk gate in CI) | No `.github/workflows` in either repo | Vulnerable transitive deps ship silently | Should fix pre-launch |
| S13 | LOW | Seed fixtures contain plausible real-looking plaintext passwords in source | `artifysolscom/server/core/db.ts:136,152,181` | Fine for a demo fixture; must not be copy-pasted into a real seed script | Track |
| S14 | INFORMATIONAL | `tsconfig.json` has no `strict` mode in either repo | Both `tsconfig.json` | Type-safety net is weaker than it could be; not itself a vulnerability | Track for Phase 15 |
| S15 | INFORMATIONAL | Two AI-consultant endpoints call different Gemini model strings (drift) | `server.ts:128` vs `api/index.ts:102` (`gemini-3.7-flash` vs `gemini-2.5-flash`); `artify-backend/server.ts` uses non-existent `gemini-3.8-flash` | Inconsistent behavior between deploy targets, not a security hole per se | Fix during consolidation (Phase 1) |

No SQL injection findings — there is no SQL anywhere yet (no persistence layer exists at all), so this class of risk is currently moot and must be re-audited once Phase 2 lands real queries.

## 2. Target security architecture

**Authentication**
- Real credential verification only (port `authService.login`), no client-side fabrication path left reachable in any build.
- Password hashing: bcrypt (cost ≥ 12) or argon2id — replaces `crypto.createHash('sha256')`.
- Session tokens: keep the existing `art_sess_<32 random bytes>` bearer-token shape; add refresh-token rotation and server-side revocation list; TTL configurable per role (shorter for Super Administrator).
- Rate-limit `/auth/login` and `/auth/register` specifically (e.g. 10 attempts / 15 min / IP+email) — brute-force protection does not exist today.
- Password reset flow: does not exist today; add token-based reset with short-lived signed tokens, no security questions.

**Authorization** — see `AUTHORIZATION_MODEL.md` in full.

**Session security**
- `Secure`, `HttpOnly`, `SameSite=Strict` if/when a cookie-based session is introduced for the browser apps (Bearer-in-`Authorization`-header remains fine for service-to-service/API-key use).
- Explicit logout revokes server-side (`authService.logout` already does this — keep it, extend to revoke *all* sessions on password change).

**API security**
- CORS allow-list: exactly the Control Center origin and the artifysolscom origin(s) — reject everything else. Currently: no CORS middleware at all in either app.
- Rate limiting per-IP and per-API-key (the `ApiKeyRecord.rateLimitPerMin` field already exists in the type — it's just never enforced).
- Request body size limits on `express.json()` (currently unbounded).
- Centralized error handler that never leaks stack traces or internal error messages to the client in production (today errors are returned ad-hoc per route via `err?.message`, sometimes verbatim).

**Secrets management**
- No secret ever hardcoded as a fallback value in source (fixes S3/S4) — required env vars fail loudly at boot instead of silently defaulting.
- Webhook signatures: HMAC-SHA256 over the raw request body with a timing-safe compare (`crypto.timingSafeEqual`), reject on missing OR mismatched signature (fixes S3), add a timestamp header + replay window (5 min) and idempotency key.
- Rotate the currently-committed `ARTIFY_WEBHOOK_SECRET` value in `.env.example` before Phase 1 — treat it as already compromised since it has been in git history.

**File uploads**: not yet implemented anywhere; when the Media module (Phase 9) gets real uploads, enforce type/size allow-lists, virus scanning if feasible, and store via signed URLs to object storage rather than through the app server.

**PII handling**: structured logger with field-level redaction for email/phone/payment data (fixes S8); audit logs may retain PII (that's their job) but must be access-controlled via `audit.view` permission, already modeled.

**Security headers**: adopt Helmet (or an equivalent explicit header set) covering CSP, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options` (already partially present), `Referrer-Policy` (already present) — apply identically across both repos' servers instead of the current partial/inconsistent set.

**Dependency hygiene**: `npm audit --audit-level=high` (or Dependabot) as a required CI check (Phase 15).

## 3. Non-findings worth stating explicitly (per the audit's "don't exaggerate" instruction)
- No SQL injection surface exists yet (no SQL at all).
- No XSS finding was identified in React component code during this pass (React's default escaping is intact; no `dangerouslySetInnerHTML` misuse was found in the files reviewed) — a full XSS pass should still be part of Phase 15's QA/security phase once real user-generated content (CMS articles, AI-drafted content) is rendered.
- The real backend's RBAC *design* (permission model, middleware) is sound; its problem is that it's unused and unpersisted, not that it's architecturally wrong.
