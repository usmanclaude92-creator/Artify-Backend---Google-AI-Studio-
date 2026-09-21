# CI/CD

## Artify-Backend (`.github/workflows/ci.yml`)

Runs on push to `main`/`claude/**` and on PRs to `main`. Real quality gates, in order — any step failing fails the job:

1. `npm ci`
2. `npx prisma generate`
3. `npx prisma migrate deploy` — against a real `postgres:16` **service container** spun up by the workflow (not mocked, not skipped)
4. `npm run typecheck` — both `tsconfig.json` (frontend) and `tsconfig.server.json` (backend, strict)
5. `npm run lint` — ESLint over `server/`
6. `npm run test:unit`
7. `npm run test:integration` — against the same Postgres service container
8. `npm run test:security` — webhook signature + authz regression suites
9. `npm run build` — both the Vite frontend and the esbuild server bundle must succeed
10. `npm run audit` (`npm audit --audit-level=high`) — **`continue-on-error: true`**, deliberately. See below.

### Why the audit step doesn't hard-fail the pipeline
As of Phase 1, `npm audit --audit-level=high` reports 8 findings, all inside the `vitest`/`vite`/`esbuild` dev-tooling chain and `prisma`'s `deepmerge-ts` — none reachable from the production bundle (verified: `esbuild server.ts --bundle --packages=external` only bundles first-party code plus runtime deps, not devDependencies). Hard-failing CI on these would block every PR on a fix that requires an upstream breaking-change bump (`vitest@5`), with no actual production exposure. The step still **runs and reports** on every build — it is not hidden — this is a documented, reviewed exception, not silent tolerance. If a *new* finding appears (especially outside devDependencies), treat it as blocking and re-evaluate this exception.

## artifysolscom (`.github/workflows/ci.yml`)

Mirrors the shape without a database (this repo has none by design — `docs/ADR/ADR-001-platform-boundary.md`):
1. `npm ci`
2. `npm run typecheck`
3. `npm run lint` — scoped to `src/lib` only (Phase 1's additions: `apiClient.ts`). The existing ~100+ pre-Phase-1 components and the legacy `server/` directory (scheduled for relocation, see its `README.md`) are not linted yet — retrofitting lint across all of it is out of Phase 1 scope and would surface a large, unrelated backlog of pre-existing issues. This is a deliberate, narrow starting scope, not an oversight.
4. `npm run build`
5. `npm run audit` — currently 0 vulnerabilities, hard-fails if that changes (no exception configured here).

## What's deliberately NOT yet in CI
- **E2E tests**: no Playwright/browser suite exists yet (`docs/TESTING.md` — Phase 15 target, not Phase 1).
- **Deployment**: CI builds and tests; it does not deploy. Railway/Vercel's own git-integration triggers remain the deploy mechanism for now — wiring CI as a required check before deploy is a Phase 16 item.
- **Staging environment**: does not exist yet (Phase 16).
- **Full-repository lint**: both repos' `lint` scripts are scoped to Phase 1's new code, not retrofitted across every existing file — see the two repos' scope notes above and `docs/IMPLEMENTATION_PLAN.md` Phase 15.
