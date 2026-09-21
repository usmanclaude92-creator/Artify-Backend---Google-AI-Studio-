# ADR-004: Multi-Tenancy — Shared Schema with `company_id` Row Scoping

## Status
Accepted (Phase 0)

## Context
Multi-tenancy is already conceptually present in the unused `server/` code: every sensitive table-equivalent (`Map`) carries a `companyId`, and `enforceTenantIsolation` middleware exists (`CURRENT_STATE.md` §2.4, `AUTHORIZATION_MODEL.md` §2). It is not, however, consistently enforced (§3.1/§3.3) and there is no real database to isolate in the first place.

## Decision
Continue with a **shared-schema, row-level tenant isolation** model: every tenant-scoped table has a `company_id` foreign key, every query is scoped by it at the repository layer (not just route middleware — defense in depth), and a `Super Administrator` role retains a documented, audited cross-tenant bypass for platform operations (mirrors the existing `Super Administrator` bypass already coded into `requirePermission`/`requireRole`/`enforceTenantIsolation`).

## Consequences
- Simpler operationally than schema-per-tenant or database-per-tenant at Artify's expected scale (tens to low hundreds of client organizations, not thousands requiring hard physical isolation).
- Requires strict discipline: every new table and every new query must include the `company_id` filter — enforced via the repository layer plus the security test suite in `TESTING_STRATEGY.md` §4.3, not just code review.
- The specific bug class found in Phase 0 (`AUTHORIZATION_MODEL.md` §3.1 — permission-checked but not ownership-checked routes) is exactly the failure mode this ADR's "defense in depth at the repository layer" is meant to prevent from recurring.

## Alternatives considered
- Database-per-tenant: rejected — operationally heavier (migration fan-out, connection management) than the expected tenant count justifies; revisit only if a specific enterprise customer contractually requires physical data isolation.
- Schema-per-tenant (single DB, many Postgres schemas): rejected for the same reason, with added migration tooling complexity.
