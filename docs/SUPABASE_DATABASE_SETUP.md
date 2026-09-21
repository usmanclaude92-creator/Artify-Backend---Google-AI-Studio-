# Supabase Database Setup

**No password, connection string, or other credential appears anywhere in this document.** Every value below is either safe-to-share metadata (project ref, region) or an instruction to look the real value up in your own secret store.

## Project configuration

| Field | Value |
|---|---|
| Project ref | `cfkymotcnccgvkpmcevp` |
| Project URL | `https://cfkymotcnccgvkpmcevp.supabase.co` |
| Database engine | PostgreSQL (Supabase-managed) |
| Connection mode used | Session-mode pooler, port 5432 (see `docs/ADR/ADR-014-supabase-connection-pooling.md`) |

The project URL above is **not** a database connection string — Supabase's REST/dashboard URL and its Postgres connection string are different things. Get the actual `DATABASE_URL` from **Supabase Dashboard → Project Settings → Database → Connection string** (choose "Session mode" / "URI"), or from wherever your team stores it (a password manager, your deployment platform's secret store — Railway/Vercel environment variables, etc.). Never paste it into a chat, a commit, or a doc.

## Environment variables

Per `docs/ENVIRONMENT_CONFIGURATION.md`, the application reads exactly one database-related variable:

```bash
DATABASE_URL="postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres?schema=public"
```

Replace `<PASSWORD>` with the real database password from the dashboard above — never a value typed into this file, `.env.example`, source code, or a commit message. `server/config/env.ts` validates the format (`postgresql://` or `postgres://` prefix, non-empty) and the app refuses to boot if it's missing — see that file for the exact validation.

`DIRECT_DATABASE_URL` is **not currently a variable this application reads** — see `ADR-014` for why it's reserved but not yet wired up, and what would need to change to introduce it.

## Connection strategy

Session-mode pooler (`ADR-014`) — compatible with Prisma's default prepared-statement behavior, no `?pgbouncer=true` flag needed (that flag is for transaction-mode pooling, which this project does not use). `?schema=public` for the primary/production database; local development and CI use a distinctly-marked separate database/schema instead — never the same one production points at (`docs/DATABASE_SETUP.md`).

## Migration procedure

Exactly `docs/DATABASE_SETUP.md`'s existing procedure, extended per `ADR-013`:

```bash
# 1. Point DATABASE_URL at the designated Supabase project (session-mode pooler URL from the dashboard).
# 2. Confirm you're connecting to the right thing before running anything destructive:
psql "$DATABASE_URL" -c "SELECT current_database(), version();"

# 3. Check what's already there — do NOT assume an empty-looking database is safe (§54).
npx prisma migrate status

# 4. Apply migrations (never `prisma db push`, never `prisma migrate reset` — §54):
npx prisma migrate deploy

# 5. Verify.
npx prisma migrate status
```

**Before running step 4 against this specific project**: confirm with whoever controls it whether it currently holds any real data. If it does, do not proceed past step 3 without a reviewed, data-preserving migration plan — this repository's Phase 2 migration was authored and verified against an empty schema (see `docs/PHASE_2_COMPLETION_REPORT.md` "Database") and has not itself been confirmed safe against a non-empty target.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Connection hangs / times out | Network egress blocked (a sandboxed CI/dev environment without outbound access to Supabase — this is what happened during this project's own Phase 2 build, see below) | Confirm the environment can reach `*.pooler.supabase.com:5432` at all (`nc -zv` or an equivalent raw TCP check) before assuming a credentials problem. |
| `prepared statement "sX" already exists` | Connected to the transaction-mode pooler (port 6543) instead of session-mode (port 5432) | Use the session-mode connection string, or add Prisma's `?pgbouncer=true` + a separate `directUrl` if transaction-mode is genuinely required (`ADR-014`). |
| `FATAL: too many connections` | Direct connection (not pooled) under concurrent load | Use the pooler connection string, not the direct one, for application traffic. |
| Migration says schema is up to date but a table is visibly missing/different | `_prisma_migrations` table state doesn't match `prisma/migrations/` on disk (e.g. a migration was applied by hand outside Prisma) | Do not force-resolve without understanding why first — `npx prisma migrate status` shows the drift; investigate before running `prisma migrate resolve`. |

## Known limitation from this project's Phase 2 build (documented, not hidden)
This session's execution sandbox could not reach the designated Supabase project at all — a raw TCP probe to its Postgres port timed out, and even a plain HTTPS request to `supabase.com` itself was rejected by the sandbox's own egress proxy with a 403. This is a property of that specific execution environment, not of Supabase or this application. All schema/migration work for Phase 2 was built and verified against a local PostgreSQL instance instead (same schema, same migrations, same `CHECK` constraints — see `docs/PHASE_2_COMPLETION_REPORT.md` for exactly what was and wasn't verified). Apply and verify the migration against the real project from an environment with real network access to it, following the procedure above.

## Security notes
- The Supabase database password is a credential like any other — store it in your deployment platform's secret manager (Railway/Vercel/etc. environment variables) or a password manager, never in git, never in a doc, never in a log line (`server/core/logger.ts`'s redaction list already covers common secret field names, but a raw connection string pasted into an unrelated log field would not be caught — don't paste it anywhere near logging code).
- Rotate the password if it is ever pasted into a chat, ticket, or any non-secret-manager location — treat that exposure the same as any other credential leak (mirrors the Phase 0 finding about the compromised webhook secret: once a secret has been in a place it shouldn't, the only safe response is rotation, not just deleting the message).
- The application connects with a single database role with full read/write on application tables — there is no per-end-user database credential (`ADR-015`). Protecting `DATABASE_URL` *is* protecting the whole database; there's no secondary boundary at the Postgres layer.
