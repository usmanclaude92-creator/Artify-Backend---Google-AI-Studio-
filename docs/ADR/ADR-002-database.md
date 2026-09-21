# ADR-002: Database — PostgreSQL with Prisma

## Status
Accepted (Phase 0); ORM choice resolved (Phase 1)

## Context
Neither repository has a real database today (`CURRENT_STATE.md` §1.2, §3). All existing data shapes (`server/types/index.ts`) are already relational — every entity carries a `companyId` foreign key, enums, and clear one-to-many relationships (company → users, company → subscriptions, company → articles).

## Decision
Adopt PostgreSQL as the sole system of record, accessed through an ORM (Prisma or Drizzle — final pick deferred to Phase 1 kickoff based on team familiarity; both are compatible with the existing TypeScript codebase). See `DATABASE_DESIGN.md` for conventions (UUID PKs, soft deletes, optimistic locking, transactions, pooling, backups).

**Phase 1 resolution: Prisma.** Chosen over Drizzle for its migration ergonomics (`prisma migrate dev`/`deploy` with generated, reviewable SQL) and generated-client type safety, which mattered more for Phase 1's goal of a fast, low-risk identity/webhook foundation than Drizzle's closer-to-SQL control. This is not a rejection of Drizzle on technical merit — revisit only if Prisma's migration engine becomes a real friction point at scale. See `docs/PHASE_1_COMPLETION_REPORT.md` for what was actually built on it.

## Consequences
- `server/core/db.ts`'s `Map`-based store is replaced by repository classes; this is the largest single structural change in Phase 2.
- Real backups, migrations, and connection pooling become operational responsibilities that did not exist before.
- Multi-tenant queries must always filter by `company_id` — enforced at the repository layer, not just in route middleware, as defense in depth against the class of bug found in `AUTHORIZATION_MODEL.md` §3.1.

## Alternatives considered
- MongoDB: rejected — the data is inherently relational (FKs, joins for reporting), and the existing types already model it that way; a document store would fight the schema rather than fit it.
- Keeping an in-memory store with periodic snapshotting: rejected — does not solve durability, concurrency, or multi-instance deployment, and the brief explicitly calls for a real production database.
