# ADR-013: Database Migration Strategy

## Status
Accepted (Phase 1, extended in Phase 2)

## Context
Phase 1 established Prisma Migrate as the migration tool (`docs/DATABASE_SETUP.md`). Phase 2 substantially restructures the schema (renaming `companies`→`organizations`, replacing `User.role`/`permissions` with `role_id`, replacing `Session.token` with `token_hash`, adding ~25 new tables) and explicitly requires: every change goes through a reviewed migration, destructive operations are inspected before applying, `prisma db push` is never used as a deployment mechanism, and a migration is tested against a clean database before touching the designated production target.

## Decision
1. **`prisma migrate deploy`** is the only command that applies migrations outside local development (`prisma migrate dev` for local iteration, exactly as Phase 1 established).
2. **Every migration is generated, then hand-reviewed, before being applied anywhere.** Phase 2's migration (`20260920000001_phase2_core_data_model`) was generated via `prisma migrate diff --script` (non-interactive, scriptable — `prisma migrate dev` refuses to run non-interactively, which this environment is) against a schema-only diff, then reviewed line-by-line for destructive operations (documented in the migration file's own header comment) before being hand-extended with the `CHECK` constraints Prisma's DSL can't express and applied.
3. **Verification order, per the brief's §53**: schema-only diff generated → reviewed for destructive operations → applied to a clean local database → application code updated to match → full test suite run against it → only then would it be applied to the designated Supabase project. The last step is currently blocked by this environment's network access (`ADR-008`), not skipped — see `docs/PHASE_2_COMPLETION_REPORT.md`.
4. Migration files are committed to git and are the single source of truth for schema history — no manual `ALTER TABLE` against any real environment outside a migration file.

## Consequences
- The Phase 2 migration's destructive step (`DROP TABLE "companies"`) is safe and documented precisely because it was verified empty in every environment the migration was applied to (Phase 1's local dev/test data was reset to a clean baseline before generating the diff — see the migration file's header). A future migration with genuine production data would need a data-preserving rename/backfill strategy instead, which this ADR does not yet need to specify because no such data exists yet.
- Rollback strategy for now (no production data exists): write and apply a new forward migration that reverses the change — Prisma has no native down-migration. This is a Phase 16 (production deployment hardening) item once real data makes a tested rollback plan necessary per-migration, not resolved further here.

## Alternatives considered
- `prisma db push` for rapid schema sync: explicitly forbidden by the brief for production use — it does not produce a reviewable migration file and can silently apply destructive changes. Not used anywhere in this project's scripts (`package.json` has no `db:push` script).
- A single squashed "baseline" migration instead of Phase 1 + Phase 2 as two separate migration files: rejected — the two-migration history is the accurate record of what actually happened and is safe to keep since no production data exists to make replaying two migrations more painful than one.
