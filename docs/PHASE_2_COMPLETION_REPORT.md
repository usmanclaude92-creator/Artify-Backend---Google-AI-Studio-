# Phase 2 Completion Report — Database Architecture, Supabase PostgreSQL & Core Data Model

Scope: `docs/IMPLEMENTATION_PLAN.md`/the Phase 2 brief's database and core-data-model work only. No CRM/CMS/billing UI, client onboarding, AI automation, or production deployment was implemented — see `docs/PHASE_2_IMPLEMENTATION.md` §8 for the exact boundary. States are IMPLEMENTED, PARTIALLY IMPLEMENTED, MISSING, DEFERRED, or BLOCKED, per the same "don't claim more than is verified" discipline used in the Phase 1 report.

## Phase Status: **PARTIALLY COMPLETE**

Every part of Phase 2 that could be built and verified in this execution environment is complete and verified against a real (local) PostgreSQL instance. The one part that could not be completed is verification against the actual designated Supabase project itself, because this sandbox has no network path to it — that is reported below as **BLOCKED**, not silently skipped and not faked. Nothing else in this report is marked complete without having been run and observed, not merely written and assumed correct.

## Database Provider
**PostgreSQL**, designated production target Supabase (project ref `cfkymotcnccgvkpmcevp`, `ADR-008`). All Phase 2 schema/migration/constraint work was authored and verified against a local PostgreSQL 16 instance that mirrors the target engine exactly — no SQLite, no in-memory store, no seed-array-as-runtime-data anywhere in the new schema.

## ORM
**Prisma**, sole database access layer (`ADR-009`) — no second ORM, no Supabase client library, no direct Postgres access from the frontend. `@prisma/client` is the only thing that talks to the database.

## Connectivity
**BLOCKED — external Supabase connectivity unavailable in current execution environment.** A raw TCP probe to the designated project's pooler host/port timed out; a plain HTTPS request to `supabase.com` itself was rejected by this sandbox's own egress proxy with a 403. This is a property of the execution sandbox, not of the application or the Supabase project — `DATABASE_URL` is the only thing that would change to point at it, and nothing in `server/` or `prisma/schema.prisma` assumes a specific host. Everything below marked "verified" was verified against a local Postgres instance instead, honestly labeled as such throughout this report. See `docs/SUPABASE_DATABASE_SETUP.md` for the exact troubleshooting evidence and the procedure to apply/verify against the real project from an environment with real network access.

## Schema
30 application tables across 9 domains (Identity, Security, CRM, Products, Commercial, CMS, Media, Notifications, Configuration) — `prisma/schema.prisma`, documented table-by-table with ER diagrams in `docs/DATABASE_SCHEMA.md`. UUID primary keys, snake_case columns via `@map`, explicit `DATE` vs `TIMESTAMP(3)` typing (business dates vs event moments), every tenant-owned table carries a NOT NULL `organization_id`. `npx prisma validate` and `npx prisma format` both pass clean (verified this session).

## Migrations
Two migrations total: Phase 1's `20260919210457_init_identity_webhook_foundation` and Phase 2's `20260920000001_phase2_core_data_model`. `npx prisma migrate status` reports the local dev database up to date with both. Generated via `prisma migrate diff --script` (non-interactive workaround), hand-reviewed before applying, hand-extended with `CHECK` constraints. Applied via `prisma migrate deploy` only — never `db push`, never `migrate reset` against anything resembling production. Migration files are committed.

## Constraints
Real PostgreSQL-enforced, not just application-level: unique constraints (email, org slug, permission key, role-permission pair, active membership, `(provider, delivery_id)`), foreign keys with a deliberate per-relationship deletion strategy (RESTRICT on tenant/client scope to protect financial/business history, SET NULL on soft references like `audit_logs.actor_user_id` and `leads.assigned_to`, CASCADE only on pure structural/join rows), and 17 hand-added `CHECK` constraints covering non-negative monetary/quantity values, date-range sanity, and the `content_revisions` exactly-one-parent rule. All 11 constraint-violation scenarios in `tests/integration/schemaConstraints.test.ts` are proven by direct-Prisma tests that bypass the service layer — the database itself rejects bad data even if the API were bypassed entirely, not merely the application code.

## Indexes
Applied on every documented high-value column: `users.email`, `sessions.user_id`/`expires_at`, `organization_memberships`' FK + uniqueness columns, `audit_logs`' actor/org/resource/created_at columns, `leads`/`clients.organization_id`, `products.code`, `subscriptions`/`invoices.organization_id`, and CMS content-status fields. Full list in `docs/DATABASE_SCHEMA.md`'s indexing section.

## Multi-Tenancy
Real `organizations` + `organization_memberships` model (`ADR-010`) supporting Artify's own internal organization alongside client organizations, with a user able to hold membership in more than one organization at different roles — not the "one user = one company" shape Phase 0/1 had. `organization_id` is the consistent tenant-scope convention across every domain table, distinct from `client_id` (who a commercial record is about). Session-based org-switching between a user's multiple memberships is **not** implemented — a user still operates against one "home org" per session, same as Phase 1; that's explicitly deferred to Phase 3, not silently dropped (`ADR-010`). Cross-tenant isolation is proven at the query layer by `tests/security/rbacAndAudit.test.ts`'s direct-Prisma test (`findFirst({id: leadA.id, organizationId: orgB.id})` returns null).

## RBAC
Normalized `roles`/`permissions`/`role_permissions` tables (`ADR-011`), replacing Phase 0/1's flat per-user permission array and 13-role enum with five roles (`SUPER_ADMIN`/`ADMIN`/`MANAGER`/`USER`/`VIEWER`) and a ~40-entry namespaced permission catalog. Resolved at read time via `roleRepository.resolveById()`, not cached/hardcoded — proven data-driven by a test that grants a brand-new permission via a direct `role_permissions` insert and shows the resolved role picks it up without a code change. SUPER_ADMIN gets a code-level middleware bypass, mirrored by seeding it with every permission so the two mechanisms stay in audit-consistent agreement.

## Audit
`audit_logs` is append-only by convention — the repository exposes exactly one method (`record`), proven by a test asserting `Object.keys(auditLogRepository)` equals `["record"]`. Records use `actor_user_id` with `SET NULL` on user deletion (proven by a test: delete the actor, the audit record survives with `actor_user_id: null`), and split `before_data`/`after_data`/`metadata` JSONB fields rather than one opaque blob. A DB-role-level `REVOKE UPDATE, DELETE` grant (so not even a raw SQL bypass could alter history) is documented as a future deployment-hardening step, not yet applied — tracked in Remaining Risks below.

## Financial Precision
`NUMERIC(18,3)` via Prisma `Decimal` on every monetary field (contract/subscription/invoice amounts), never float, with `CHAR(3)` ISO currency codes — chosen specifically because OMR needs 3 decimal places (`ADR-012`). Proven by a test that round-trips `1000.125` through Prisma's `Decimal` type and asserts exact string equality, not float comparison. Backed by 12 hand-added `CHECK` constraints rejecting negative monetary/quantity values at the database level.

## CMS Foundation
`pages`/`posts`/`categories`/`tags`/`authors`/`content_revisions`/`post_tags` — schema only, no CMS service or route layer yet (Phase 8, per the target roadmap). Content lifecycle modeled as an enum (`DRAFT`→`IN_REVIEW`→`SCHEDULED`→`PUBLISHED`→`ARCHIVED`); revisions are immutable snapshots referencing exactly one parent (page or post) via a hand-added `CHECK (num_nonnulls(page_id, post_id) = 1)` constraint, since Prisma has no native XOR/polymorphic-FK support — proven rejected by a direct-Prisma test.

## Commercial Foundation
`contracts`/`subscriptions`/`subscription_items`/`invoices`/`invoice_items` — schema only, no billing/payment integration (that's explicitly out of scope; no Stripe/payment processor call exists anywhere). Historical-integrity principle applied throughout: these records use status fields and are never soft-deleted or destructively updated, preserving audit/financial history even as their lifecycle progresses.

## Testing
**81 tests passing, 10 test files, 0 failing** — run this session against a real local PostgreSQL instance, not mocked (`npx vitest run`). Breakdown: 58 tests carried over from Phase 1 and updated for the renamed schema (`auth.test.ts`, `authz.test.ts`, `webhook.test.ts`, `health.test.ts`, unit tests), plus 20 new Phase 2 tests (`schemaConstraints.test.ts`: 11, `rbacAndAudit.test.ts`: 9), plus 3 new tests added to `health.test.ts` for the `/system/database` endpoint. `npx tsc --noEmit` and `npx eslint .` both pass clean. `npm run build` succeeds (frontend + server bundle). `npm audit`: pre-existing findings, all in devDependencies (Prisma CLI's `deepmerge-ts` transitive dependency, Vite/Vitest's bundled `esbuild`) — none reachable from the production runtime bundle, unchanged in nature from the 8 findings already documented and accepted in the Phase 1 report; no new production-dependency vulnerability was introduced this phase.

## Supabase Verification
**Not verified against the real project — BLOCKED, stated plainly, not worked around.** What *was* verified, against a local Postgres instance built to mirror the target exactly (same PostgreSQL engine, same `prisma/schema.prisma`, same migration file, same hand-added `CHECK` constraints): schema creation from a clean database, all 30 application tables present (`psql \dt`), all constraints present (`pg_constraint`), the full migration applied via `prisma migrate deploy`, the full test suite passing against real queries, `prisma migrate status` reporting the schema up to date. What was **not** verified: actual network reachability to `cfkymotcnccgvkpmcevp.supabase.co`, the real connection string's validity, session-mode-pooler behavior against the live pooler, or any data present in that specific project today. The real database password was never exposed — see `docs/PHASE_2_IMPLEMENTATION.md`'s "Credential handling" section for the specific handling and the sweep performed before this commit.

## Remaining Risks

| Risk | Status | Owner/Phase |
|---|---|---|
| Supabase project connectivity unverified from this environment | BLOCKED (environmental) | Apply/verify from an environment with real network access, following `docs/SUPABASE_DATABASE_SETUP.md` |
| Backup/point-in-time-recovery not confirmed for the real Supabase project | UNCONFIRMED | Whoever controls the Supabase project — cannot be confirmed without connectivity |
| CRM/CMS/Commercial/Products/Media/Notifications have schema only, no service/route layer | DEFERRED (by design) | Phase 5+ per the target roadmap |
| Session-based switching between a user's multiple `OrganizationMembership` rows | DEFERRED (documented) | Phase 3 |
| `audit_logs` DB-role-level `REVOKE UPDATE, DELETE` (defense-in-depth beyond app-layer append-only) | DEFERRED | Phase 16 deployment hardening |
| Row Level Security not enabled (deliberate — backend authorization boundary instead) | BY DESIGN, documented | `ADR-015`; revisit only if a compliance requirement for DB-layer defense-in-depth emerges |
| `DIRECT_DATABASE_URL` not implemented as a separate variable | BY DESIGN, documented | `ADR-014`; add only if a real deployment target surfaces a concrete need |
| Pre-existing devDependency audit findings (Prisma/Vite tooling chain) | TRACKED, non-blocking, unchanged from Phase 1 | Re-evaluate on next dependency bump |
| No password reset / MFA / refresh-token rotation | DEFERRED (by design, unchanged from Phase 1) | Phase 3 |

## Phase 3 Readiness
The identity/tenant/RBAC/audit foundation Phase 3 needs is in place and tested: real multi-org data model, data-driven permission resolution, hashed session tokens, append-only audit trail, tenant-scoped queries proven to reject cross-org access. Phase 3 (per the brief's own final rule) has **not** been started — no auth redesign beyond what Phase 2 already needed to connect its schema, no CRM/CMS/billing UI, no client onboarding, no AI automation, no production deployment. This report and the underlying commit stop here, as instructed.
