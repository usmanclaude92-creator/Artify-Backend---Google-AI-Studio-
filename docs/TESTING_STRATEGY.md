# QA / Testing Target Architecture

## 1. Current state
**Zero automated tests exist in either repository.** No test files, no test runner in either `package.json`, `"lint"` is merely `tsc --noEmit` (not a lint tool, and not a test). This is confirmed by a full repository file listing in both repos — no `*.test.*`/`*.spec.*` files anywhere. Do not count `tsc --noEmit` as a test suite in any Phase reporting.

## 2. Target testing pyramid

```
        ┌─────────────┐
        │     E2E     │  Playwright — critical user journeys, few, slow, high confidence
        ├─────────────┤
        │  Security   │  authz/tenant-isolation-focused, runs in CI on every PR touching routes/
        ├─────────────┤
        │     API     │  Supertest against the Express app — one per route, auth/permission/validation cases
        ├─────────────┤
        │ Integration │  service + real (test-container) Postgres, no mocked DB
        ├─────────────┤
        │    Unit     │  Vitest — pure functions: validators, RBAC permission checks, lead auto-triage scoring, sitemap generation
        └─────────────┘
```

## 3. Tooling recommendation
- **Unit/Integration**: Vitest (already Vite-native, zero extra config given both repos already run Vite 6).
- **API**: Supertest + Vitest, spun up against a test Postgres instance (Testcontainers or a disposable Railway/Supabase branch DB) — never against mocked repositories, since the whole point of Phase 2+ is real persistence.
- **E2E**: Playwright (already pre-installed and configured in this environment per session tooling) — cover login, portal subscription changes, admin CRUD, lead submission end-to-end.
- **Security tests**: a dedicated Supertest suite specifically targeting the gaps found in `AUTHORIZATION_MODEL.md` §3.1 (attempt cross-tenant reads/writes with a valid-but-wrong-tenant token and assert 403) — this suite is the regression guard for S7.
- **Performance**: k6 or Autocannon smoke tests on the platform API's hot paths (auth, product listing, AI consultant) before major releases — not required for every PR.

## 4. Critical business workflows requiring test coverage (derived from `CURRENT_STATE.md`'s API tables)
1. Register → login → receive valid session → `GET /auth/me` returns correct user+company.
2. Login with wrong password → rejected; login to a `disabled`/`suspended` account → rejected.
3. Cross-tenant record access attempts on every mutation route in `AUTHORIZATION_MODEL.md` §3.1 → all rejected (403).
4. Lead submission (public, unauthenticated) → creates one record, returns a reference token, triggers CRM auto-triage.
5. Webhook lead ingestion with valid/invalid/missing signature → accepted only when valid (regression test for S3).
6. Article draft → publish lifecycle respects `blog.create`/`blog.publish` permission boundary.
7. Subscription plan change → correct invoice generated, correct quota fields updated.
8. API key creation/revocation scoped to the caller's own company only.
9. AI coworker task execution requiring approval actually blocks on `WAITING_APPROVAL` until a permitted user approves/rejects.
10. Health endpoint (`/api/v1/system/health`) fails loudly when the database is actually unreachable (regression test for S9 — currently impossible to write this test because there's no DB to disconnect).

## 5. CI gate (see `IMPLEMENTATION_PLAN.md` Phase 15)
Every PR: `tsc --noEmit` (keep, but rename away from calling it "lint"), ESLint, unit+API test suite, `npm audit --audit-level=high`. Merge to main additionally runs the E2E suite against a preview deploy. No test suite currently runs anywhere — this is 100% net-new CI, not an upgrade of an existing pipeline.
