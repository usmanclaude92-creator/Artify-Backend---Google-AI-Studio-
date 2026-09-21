# Database Setup

PostgreSQL 16+, accessed through Prisma (`prisma/schema.prisma`). See `docs/DATABASE_DESIGN.md` for the full target design and `docs/ADR/ADR-002-database.md` for why Prisma.

## Local development

Any real PostgreSQL 16+ works — a local install, Docker, or a hosted project. This repo does not mandate Docker (see `docs/DEVELOPMENT_SETUP.md` for the reasoning); the fastest path on a machine with Postgres already installed:

```bash
# Create a dev role + database (adjust to your local Postgres admin access)
psql -c "CREATE ROLE artify_dev WITH LOGIN PASSWORD 'change-me' CREATEDB;"
psql -c "CREATE DATABASE artify_dev OWNER artify_dev;"

# .env
DATABASE_URL="postgresql://artify_dev:change-me@localhost:5432/artify_dev?schema=public"

npm run prisma:generate
npm run prisma:migrate      # applies migrations, prompts for a name on schema changes
```

Prefer Docker? A minimal `docker compose up -d` with a `postgres:16` service and the same `DATABASE_URL` works identically — no code changes required, since the app only ever talks to `DATABASE_URL`.

## Test database

Use a **distinctly separate** database or schema from dev — `tests/helpers/db.ts`'s `resetDb()` truncates tables and refuses to run unless `NODE_ENV=test` and `DATABASE_URL` contains "test" (see that file's guard). Two supported patterns:
- **Separate local database** (what this repo's own CI and local dev use): `artify_test` alongside `artify_dev` on the same local Postgres instance.
- **Separate schema on a shared hosted instance**: `?schema=test` in `DATABASE_URL`, if you don't want to provision a second database on a managed provider.

```bash
# .env.test
DATABASE_URL="postgresql://artify_dev:change-me@localhost:5432/artify_test?schema=public"

DATABASE_URL="...artify_test?schema=public" npx prisma migrate deploy
```

## Migrations

- **Create + apply** (dev, interactive): `npm run prisma:migrate` — generates a new migration under `prisma/migrations/<timestamp>_<name>/migration.sql` from any `schema.prisma` changes, applies it, regenerates the Prisma client.
- **Apply only** (CI/staging/production, non-interactive): `npm run prisma:migrate:deploy` — applies any pending migrations, creates nothing new. This is what `.github/workflows/ci.yml` and any real deploy pipeline should run.
- **Inspect**: `npm run prisma:studio` opens a local GUI against whatever `DATABASE_URL` is active.
- **Rollback**: Prisma has no automatic down-migration. Recovery strategy for Phase 1's schema (identity + webhook tables only, no production data exists yet) is: write and apply a new forward migration that undoes the change. Once real production data exists (Phase 2+), pair every migration with a tested rollback plan in its own PR description — this repo does not yet have a formalized rollback-migration convention beyond "write the inverse forward migration," which is a Phase 16 (production deployment) hardening item, not resolved here.

## Backups

Not yet applicable — no production database exists yet. Whichever managed Postgres provider is chosen for Phase 2 (Railway Postgres, Supabase, or equivalent — `docs/DATABASE_DESIGN.md` §1) must have point-in-time recovery enabled from the day real user data starts landing in it, per `docs/PRODUCTION_READINESS_CHECKLIST.md`.

## Connection pooling

Prisma manages its own connection pool over `DATABASE_URL`; the Express app holds a single `PrismaClient` singleton (`server/db/prisma.ts`), not one connection per request. If a deployment target's Postgres has a low connection cap and multiple app instances run concurrently, add an external pooler (PgBouncer, or the managed provider's built-in pooler / pooled connection string) — not required for Phase 1's single-instance scope.

## Real-infrastructure verification note

Every claim about this schema being "real" was verified by actually running it: `prisma migrate dev` was applied against a live PostgreSQL 16 instance, the full test suite (58 tests, `docs/TESTING.md`) ran against it, and the built production server (`node dist/server.cjs`) was started against it and exercised via `curl` for registration, login, session verification, and all six webhook signature scenarios (valid, missing, invalid, tampered, replayed, duplicate) — see `docs/PHASE_1_COMPLETION_REPORT.md` for the results. This sandbox's network egress is allow-listed and cannot reach an arbitrary external hosted Postgres instance (verified directly — see that report's "Database" section), so this verification used a local Postgres instance; the schema and application code are provider-agnostic and make no assumption about where `DATABASE_URL` points.
