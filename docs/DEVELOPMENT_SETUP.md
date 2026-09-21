# Development Setup

## Prerequisites
- Node.js 20+ (`.node-version`/`package.json` `engines.node`)
- npm (this repo standardizes on npm — see `docs/PHASE_1_IMPLEMENTATION.md` §3/§6 and the `artifysolscom` repo's equivalent note for the `bun.lock` removal there)
- PostgreSQL 16+ reachable via a connection string (local install, Docker, or hosted — see `docs/DATABASE_SETUP.md`)

Docker is **not mandatory**: nothing in the build or run path requires it (the app doesn't containerize its own dev loop), only a running Postgres does, and a local install works identically. Use Docker for Postgres if that's your team's preference — `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=change-me postgres:16` is enough to get `DATABASE_URL` working.

## 1. Install dependencies
```bash
npm install
```

## 2. Environment configuration
```bash
cp .env.example .env
```
Fill in `DATABASE_URL`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `CORS_ORIGINS` at minimum — see `docs/ENVIRONMENT_CONFIGURATION.md` for what each does and how to generate secret values. The app refuses to start with placeholders left empty for a required variable.

## 3. PostgreSQL setup
See `docs/DATABASE_SETUP.md`. Short version:
```bash
npm run prisma:generate
npm run prisma:migrate
```

## 4. Migration commands
```bash
npm run prisma:migrate          # create + apply a migration from schema.prisma changes (dev)
npm run prisma:migrate:deploy   # apply pending migrations only, no prompts (CI/staging/prod)
npm run prisma:studio           # local DB GUI
SEED_ADMIN_PASSWORD="ChangeMe123!" npm run db:seed   # creates one Company + one Super Administrator (identity only — no business data; see prisma/seed.ts)
```

## 5. Development server
```bash
npm run dev
```
Starts `server.ts` under `tsx`, which boots the Platform API (`server/app/app.ts`) and Vite's dev middleware for the frontend on the same port (`PORT`, default 3000).

## 6. Tests
Requires a **separate** test database/schema — see `docs/DATABASE_SETUP.md` "Test database" and `docs/TESTING.md`.
```bash
cp .env.example .env.test   # then edit: NODE_ENV=test, a test-marked DATABASE_URL, etc.
DATABASE_URL="<your test db url>" npx prisma migrate deploy   # apply schema to the test DB once

npm run test:unit
npm run test:integration
npm run test:security
npm test                    # everything
```

## 7. Lint / typecheck
```bash
npm run typecheck   # tsc --noEmit (frontend, root tsconfig.json) + tsc --noEmit -p tsconfig.server.json (backend, strict)
npm run lint         # eslint over server/ (see docs/CI_CD.md for why the existing frontend src/ isn't linted yet)
```

## 8. Build
```bash
npm run build   # vite build (frontend) + esbuild bundle of server.ts → dist/server.cjs
npm start        # runs the production build (requires NODE_ENV=production and all required env vars set — no dev fallbacks)
```

## 9. CI-equivalent local validation
Everything `.github/workflows/ci.yml` runs, in order, runnable locally against your own dev+test databases:
```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration && npm run test:security && npm run build && npm run audit
```

## Two tsconfigs, on purpose
`tsconfig.json` (root) covers the existing frontend `src/` under Vite's default, non-strict settings — unchanged from before Phase 1, since retrofitting `strict` across the ~100 pre-existing component files is Phase 15 scope, not Phase 1. `tsconfig.server.json` covers `server/`, `server.ts`, and `tests/` under full `strict` (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`) — every line of Phase 1's new backend code is strict-clean. `npm run typecheck` runs both.
