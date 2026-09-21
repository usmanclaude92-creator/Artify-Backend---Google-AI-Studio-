# Security Configuration (Phase 1)

What's implemented, what's deliberately deferred, and how to verify each — cross-referenced to `docs/SECURITY_MODEL.md`'s Phase 0 findings.

## Implemented in Phase 1

| Control | Where | Fixes / establishes |
|---|---|---|
| Real password hashing (bcryptjs, cost 12) | `server/utils/password.ts` | S5/R5 (unsalted SHA-256) |
| Real, revocable, TTL'd sessions in Postgres | `server/services/authService.ts`, `server/repositories/sessionRepository.ts` | S1/R1/R2 (client-fabricated auth) — for the *real backend*; frontend cutover is Phase 4 |
| Account lockout (5 failed attempts → 15min lock) | `server/repositories/userRepository.ts` | New — not present in Phase 0 prototype |
| Login/register rate limiting (10/15min per IP+email) | `server/middleware/rateLimiter.ts` | New |
| Generic auth-failure messages (no user enumeration) | `server/services/authService.ts` | New hardening beyond the ported design |
| Webhook HMAC-SHA256 signature, constant-time compare | `server/utils/crypto.ts`, `server/services/webhookService.ts` | **S3/R3** — the inverted "missing header = verified" bug |
| Webhook secret with no insecure fallback, compromised-value rejection | `server/config/env.ts` | S4/R4 |
| Webhook replay protection (5min timestamp window) + idempotency (unique delivery constraint) | `server/services/webhookService.ts`, `prisma/schema.prisma` `WebhookEvent` | New |
| Explicit CORS allow-list, no wildcard in prod | `server/middleware/security.ts`, `server/config/env.ts` | S6 |
| Helmet security headers (CSP, HSTS, etc.) | `server/middleware/security.ts` | S6 |
| Request body size limits | `server/middleware/security.ts` | S6 |
| Centralized error handler — no stack traces/SQL/paths leaked to clients | `server/middleware/errorHandler.ts` | New |
| Input validation (zod) on every Phase 1 route | `server/schemas/*.ts` | S10 (partial — covers auth + webhook routes; future routes must follow the same pattern) |
| Structured logging with redaction (passwords, tokens, secrets, cookies never logged) | `server/core/logger.ts` | S8 |
| Real health/readiness checks (no fabricated "connected") | `server/db/health.ts` | S9 |
| RBAC middleware with tenant-isolation check | `server/middleware/auth.ts` | Foundation for S7 — see below |
| Hardcoded compromised secret removed from source (both server fallback and client bundle) | `server.ts`, `src/context/AdminDataContext.tsx` | S3/S4/R3/R4 |
| Dependency audit as a CI gate | `.github/workflows/ci.yml` | S13 |

## Explicitly NOT fully closed in Phase 1 (tracked, not hidden)

- **S7 (horizontal privilege escalation on per-record routes)**: the `enforceTenantIsolation`/`enforceRecordOwnership` middleware exists and is unit/integration-tested (`tests/security/authz.test.ts`), but no business routes with single-record IDs exist yet to apply it to — this closes when Phase 4+ routes are built using this middleware, not before. Track via `docs/AUTHORIZATION_MODEL.md` §3.1.
- **CSRF**: not implemented. Current session transport is `Authorization: Bearer <token>`, not a cookie, so classic CSRF doesn't apply yet; revisit if/when a cookie-based session is added (Phase 3, `COOKIE_DOMAIN` is reserved for this).
- **Password reset, refresh-token rotation, MFA**: not implemented — explicitly Phase 3 per the brief. The `User.mfaEnabled` field is not yet acted on anywhere.
- **Dependency vulnerabilities**: `npm audit --audit-level=high` currently reports 8 findings (3 moderate, 4 high, 1 critical), **all in devDependencies** (a nested `vitest`/`vite`/`esbuild` chain and `prisma`'s `deepmerge-ts`), none reachable from the production runtime bundle. CI runs the audit and reports it (`continue-on-error: true` for this specific, already-triaged case — see `docs/CI_CD.md`); it is not swept under the rug, just not blocking merges over dev-tooling-only findings. Re-run `npm audit` after any dependency bump to confirm this hasn't changed.
- **Object storage / file upload security** (S6 mention in `docs/SECURITY_MODEL.md`): no uploads exist yet (Phase 9).

## How to verify the webhook fix yourself
```bash
# 1. Missing signature — must be rejected (this was the Phase 0 bug: it used to be ACCEPTED)
curl -i -X POST http://localhost:3000/api/v1/webhooks/leads \
  -H "Content-Type: application/json" \
  -d '{"deliveryId":"t1","name":"A","email":"a@b.com","companyName":"C","projectBrief":"B"}'
# → 401

# 2. Valid signature — accepted (see tests/security/webhook.test.ts for the full script,
#    including timestamp signing, that generates a correct signature)
```

## Secrets handling
- No secret has a hardcoded fallback anywhere in `server/` (enforced by `server/config/env.ts` failing to boot without one).
- `.env*` is gitignored except `.env.example`, which contains placeholders only.
- The Phase 0 compromised webhook secret value is explicitly deny-listed in `server/config/env.ts` so it can never be reused, even by accident.
- Operational rotation still required (cannot be done from source): rotate the actual secret value with whatever system called the old webhook endpoint, since the old value is public. This is tracked in `docs/PHASE_1_COMPLETION_REPORT.md` "Remaining Risks" as an operational action, not a code change.
