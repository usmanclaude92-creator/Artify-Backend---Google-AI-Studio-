# Testing (Phase 1)

## What exists today
58 tests, all passing, across three suites, run with Vitest (`vitest.config.ts`) against a real PostgreSQL instance — no mocked database. Zero tests existed before Phase 1 (Phase 0 finding: `"lint": "tsc --noEmit"` was the closest thing to a check, and that's a type-check, not a test).

| Suite | Files | What it proves |
|---|---|---|
| `tests/unit/` | `config.env.test.ts`, `password.test.ts`, `crypto.test.ts`, `requestId.test.ts` | Config validation branches (missing vars, compromised-secret rejection, prod-strictness rules), password hashing is salted bcrypt (not the old unsalted SHA-256), HMAC signing/verification including the malformed-input edge cases, request-id generation/sanitization |
| `tests/integration/` | `health.test.ts`, `auth.test.ts` | Liveness/readiness against a real DB ping; full register→login→me→logout flow against real Postgres, including the atomic-transaction registration, account lockout after 5 failures, session revocation on logout |
| `tests/security/` | `webhook.test.ts`, `authz.test.ts` | **Regression suite for the Phase 0 CRITICAL webhook vulnerability**: valid/missing/invalid/tampered/replayed/duplicate signatures, each asserted against the real HTTP route. Authorization suite: missing auth rejected, wrong permission rejected (vertical escalation), cross-tenant access rejected in both directions (horizontal escalation) — against the real middleware, via a minimal throwaway test route since no business routes exist yet to mount it on |

Run: `npm run test:unit`, `npm run test:integration`, `npm run test:security`, or `npm test` for all three. Requires a test database — see `docs/DATABASE_SETUP.md`.

## Target testing pyramid (`docs/TESTING_STRATEGY.md` — unchanged from Phase 0, restated here for what's actually built vs. still ahead)
```
        E2E              — not yet built (Phase 15, Playwright)
     Security             — IMPLEMENTED (this phase)
        API               — IMPLEMENTED, via Supertest inside integration/security suites
   Integration            — IMPLEMENTED (auth + health, against real Postgres)
      Unit                — IMPLEMENTED (config/password/crypto/requestId)
```

## Honest gaps
- **No E2E/browser tests.** Nothing exists yet for either frontend to click through automatically. Phase 15.
- **No performance/load tests.** Not attempted in Phase 1.
- **"DB unreachable → 503" is not covered by an automated test.** `server/db/health.ts`'s `checkDatabase()` catch-and-report path is exercised implicitly by every integration test's setup succeeding (if it couldn't reach the DB, every test would fail at `resetDb()`), and its logic is a straightforward bounded-timeout `try/catch`, but there is no dedicated test that severs the connection mid-run and asserts `/ready` returns 503. This would require either a second Prisma client pointed at a deliberately broken connection or a chaos-style test harness — deferred as a small, well-understood gap rather than faked with a mock. Tracked for Phase 16 (production deployment hardening), where a real chaos/failure-injection pass belongs anyway.
- **Coverage is not measured as a percentage.** Per the brief's explicit instruction ("do not aim for artificial 100% coverage... meaningful coverage of security-critical and business-critical foundations"), no coverage tool is wired in; the suite's scope was chosen to match Phase 1's actual security-critical surface (auth, webhooks, authz, config) rather than to hit a number.

## CI integration
`.github/workflows/ci.yml` runs all three suites against a `postgres:16` GitHub Actions service container on every push/PR — see `docs/CI_CD.md`.
