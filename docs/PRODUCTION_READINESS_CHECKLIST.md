# Production Readiness Checklist

Not to be signed off until every box is genuinely true — this audit found that existing documentation (`ARCHITECTURE.md`, `metadata.json`'s "production-ready" framing) had asserted readiness the code does not back up. This checklist exists to prevent that recurring.

> **Phase 2 update**: checkboxes below are updated to reflect what's now real. Unchanged boxes are still genuinely open — see `docs/PHASE_2_COMPLETION_REPORT.md` "Remaining Risks" for the honest current gap list, most notably: Supabase connectivity itself is unverified from this build environment (BLOCKED, not failed — `docs/SUPABASE_DATABASE_SETUP.md`), backups are unconfirmed, and CRM/CMS/Commercial/Products only have schema, not services/routes, so their mutation routes don't exist yet to test.

## Data
- [x] Every entity has a real, migrated Postgres table (no `localStorage`, no in-memory array, no `seedData.ts` as a runtime source) — 30 application tables across 9 domains, `prisma/migrations/`, verified against a clean local Postgres (`docs/DATABASE_SCHEMA.md`). Migration against the actual designated Supabase project itself is unverified — network egress to it was unavailable from this build's execution sandbox (`docs/SUPABASE_DATABASE_SETUP.md`).
- [ ] Backups enabled and a restore has been tested at least once — not yet confirmed against the real Supabase project (no verified connectivity to check or configure this).
- [x] Migrations are version-controlled and run automatically pre-deploy — `prisma/migrations/`, applied via `prisma migrate deploy` in CI/deploy, never `db push` (`ADR-013`). "Automatically pre-deploy" against the real Supabase target itself is unverified for the same connectivity reason above.

## Authentication & Authorization
- [x] No client-side-only authentication path exists in any shipped build — unchanged since Phase 1, still true.
- [x] Passwords hashed with bcrypt/argon2, never a fast unsalted hash — bcrypt, Phase 1, unchanged.
- [ ] Every mutation route enforces both a permission check and a per-record tenant/ownership check — true for the Identity domain's implemented routes (`enforceRecordOwnership`, `AUTHORIZATION_MODEL.md`); CRM/CMS/Commercial mutation routes don't exist yet (schema only), so this can't yet be claimed platform-wide.
- [ ] Login is rate-limited; password reset exists and is tested — rate limiting is Phase 1 (unchanged); password reset still does not exist.
- [x] Automated tests cover horizontal and vertical privilege escalation attempts and all pass (reject) — `tests/security/authz.test.ts`, `tests/security/rbacAndAudit.test.ts` (tenant-isolation query test, role-permission mapping tests), for the domains that have routes/repositories today.

## API & Web security
- [ ] CORS allow-list configured (no wildcard `*` in production).
- [ ] Rate limiting active on public and authenticated endpoints.
- [ ] Security headers (CSP, HSTS, X-Frame-Options, etc.) present on every response.
- [ ] Webhook signatures verified with a timing-safe HMAC comparison; missing signature is rejected, not accepted.
- [ ] No secret has an insecure hardcoded fallback anywhere in source; the app fails to boot without required secrets set.
- [ ] Input validation (zod or equivalent) on every route accepting a body/query/params.
- [ ] Centralized error handler never leaks stack traces to clients in production.

## Observability
- [ ] Health check endpoint performs a real dependency check (DB ping, not a hardcoded "connected").
- [ ] Structured logging with request IDs; PII fields redacted.
- [ ] Error tracking (e.g. Sentry) wired in.
- [ ] Alerting on health-check failures and elevated error rates.

## Testing & CI
- [ ] Unit, integration, API, and E2E suites all running in CI and required to pass before merge.
- [ ] `npm audit`/Dependabot gate active.
- [ ] All critical business workflows in `TESTING_STRATEGY.md` §4 have passing automated coverage.

## Deployment
- [ ] Staging environment exists and mirrors production configuration.
- [ ] Rollback procedure documented and tested.
- [ ] Both repos' deploy targets (Vercel/Railway) use one consistent server entrypoint each, with no drifted duplicate logic.

## Product-level honesty
- [ ] No UI text or documentation claims "production-ready," "SOC2," "99.9% uptime," etc. unless independently verified true — several such claims exist today only as hardcoded demo copy (e.g. `seedData.ts` audit-trail claims, `/api/health` fabricated database status) and must not migrate into real user-facing claims without substantiation.
- [ ] All "demo mode" affordances (role switcher, instant fake login) are unreachable in the production build.
