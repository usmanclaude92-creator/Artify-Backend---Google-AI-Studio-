# ADR-014: Supabase Connection Pooling Strategy

## Status
Accepted (Phase 2) — pending live verification once this session (or a future one) can reach the designated Supabase project (`ADR-008`)

## Context
Supabase Postgres exposes three connection modes ([docs](https://supabase.com/docs/guides/database/connecting-to-postgres)): a **direct connection** (full Postgres feature set, including prepared statements, but IPv6 by default / limited connection count, unsuitable for many serverless or IPv4-only hosts), a **session-mode pooler** (PgBouncer, port 5432 on the pooler host, behaves like a direct connection including prepared-statement support, holds one server connection per client for the client's session), and a **transaction-mode pooler** (port 6543, connections are returned to the pool after each transaction, does *not* support prepared statements the way Prisma issues them by default).

Prisma's query engine uses prepared statements by default. Against a transaction-mode pooler this causes intermittent `prepared statement "sX" already exists` errors under concurrent load, because different logical connections share the same underlying Postgres backend process across transactions.

## Decision
Use the **session-mode pooler** (port 5432) for `DATABASE_URL`, matching the connection string already supplied for the designated project (`aws-0-<region>.pooler.supabase.com:5432`). This is compatible with Prisma's default prepared-statement behavior with no extra configuration (no `?pgbouncer=true` flag, which is Prisma's documented workaround specifically for transaction-mode pooling and is unnecessary — and would disable prepared statements — for session mode).

`DIRECT_DATABASE_URL` is reserved (per `docs/ENVIRONMENT_CONFIGURATION.md`) for migration operations if a future deployment target requires bypassing the pooler for `prisma migrate deploy` (some hosts document doing migrations against the direct connection and application traffic against the pooler) — **not implemented as a separate variable in Phase 2** because the current `DATABASE_URL` (session-mode pooler) already supports prepared statements and migrations ran successfully against an equivalent local setup without needing a second connection string. If a real deployment against Supabase surfaces a concrete need for a separate migration-time connection, add `DIRECT_DATABASE_URL` to `server/config/env.ts`'s schema at that point rather than pre-emptively now (the brief explicitly warns against inventing unnecessary variables).

## Consequences
- Connection count: the session pooler holds one server-side connection per Prisma Client connection for that connection's lifetime — the app's single long-lived `PrismaClient` singleton (`server/db/prisma.ts`) means this is bounded and predictable, not per-request.
- If a future deployment moves to serverless functions (many short-lived Prisma Client instances, e.g. Vercel functions) rather than this project's current long-running Express process, the transaction-mode pooler plus Prisma's `?pgbouncer=true` + `directUrl` split becomes necessary — that is a deployment-target decision to make when/if that architecture is adopted, not now.
- Untestable end-to-end against the actual designated project from this session (`ADR-008`) — the reasoning above follows Supabase's own documented guidance and this project's successful local-equivalent verification, but is explicitly flagged as **pending live confirmation**, not claimed as proven against the real target.

## Alternatives considered
- Transaction-mode pooler (port 6543) + `?pgbouncer=true`: rejected for the current single-long-lived-process deployment shape — it exists specifically to solve a connection-scaling problem (many short-lived clients) this project doesn't have yet, at the cost of losing prepared-statement performance and requiring the `directUrl` split for migrations.
- Direct connection only, no pooler: rejected — Supabase's own guidance recommends the pooler for application traffic even at moderate scale, and the supplied connection string already targets the pooler host.
