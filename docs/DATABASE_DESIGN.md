# Database Design Recommendation

> **Phase 2 update**: this recommendation is now substantially implemented — 30 application tables across 9 domains (Identity, Security, CRM, Products, Commercial, CMS, Media, Notifications, Configuration). For the as-built schema, table-by-table documentation, and ER diagrams, see **`docs/DATABASE_SCHEMA.md`** — that is now the authoritative reference for what exists; this document remains the original target-state rationale and is kept for the "why," with Phase 1/2 resolution notes inline below where a decision changed. Full status: `docs/PHASE_2_COMPLETION_REPORT.md`.
>
> **Phase 1 update**: the identity + webhook slice of this design was implemented first — see `docs/PHASE_1_COMPLETION_REPORT.md`. Two decisions below were resolved or intentionally scoped down for Phase 1; both are called out inline rather than silently diverging from this doc. Phase 2 then completed the deferred `role_permissions` normalization (see the Identity family note below and `ADR-011`) and renamed `companies` → `organizations` (`ADR-010`).

## 1. Technology
**PostgreSQL, hosted on Supabase** for the designated production target (`ADR-008-supabase-postgresql.md`; Railway Postgres remains a viable alternative noted here originally, and is what local/CI environments use — `docs/DATABASE_SETUP.md`). Rationale: relational integrity for tenant/permission/billing data, native JSON columns for the flexible fields the prototype already modeled loosely (`Company.settings`, `AiCoworker.approvalPolicy`), mature migration tooling, and every entity in `server/types/index.ts` was already relational in shape (foreign keys via `companyId` everywhere — now `organization_id`, `ADR-010`).

**ORM**: **Prisma** (resolved in Phase 1 — see `ADR-002-database.md`). Replaces `server/core/db.ts`'s hand-rolled `Map` store.

## 2. Conventions
- **Primary keys**: UUID v7 (time-ordered) generated app-side or via `gen_random_uuid()` — keeps the existing prefixed-ID *display* convention (`usr_`, `org_`, `art_`) as a separate human-readable `slug`/`display_id` column if that UX is worth preserving, but the actual PK is a UUID. **Phase 1 note**: the identity tables implemented so far use Prisma's default `uuid()` (v4, non-time-ordered), not v7 — v7 support in Prisma's stable API wasn't worth the risk for a first migration. This is a low-cost, low-risk follow-up (index locality only, no schema-shape change) rather than a blocker; revisit alongside Phase 2's broader schema work.
- **Foreign keys**: every tenant-scoped table carries `company_id UUID NOT NULL REFERENCES companies(id)`, indexed.
- **Timestamps**: `created_at`, `updated_at` (`timestamptz`, default `now()`), trigger-maintained `updated_at`.
- **Soft deletion**: `deleted_at timestamptz NULL` on user-facing entities (users, articles, products, customers) so RBAC/audit history stays intact; hard-delete only for genuinely ephemeral data (sessions, telemetry events).
- **Optimistic locking**: `version integer NOT NULL DEFAULT 1` on records with concurrent-edit risk (articles, AI coworker configs, subscriptions) — increment on update, reject stale writes.
- **Constraints**: `UNIQUE(company_id, slug)` for products/articles, `UNIQUE(lower(email))` for users, `CHECK` constraints for enum-like fields already typed in `server/types/index.ts` (`status`, `role`, `tier`).
- **Indexes**: every `company_id` FK, every `(company_id, status)` pair used in list queries (mirrors the filters already in `cmsService.listArticles`, `leadService.listLeads`, `auditService.queryLogs`), full-text index (`pg_trgm` or `tsvector`) on article/product search fields since `search` query params already exist in the API.
- **Transactions**: multi-table writes (e.g. `register()` creating a company + user + subscription in one call — `authService.ts:100-201`) must become a single DB transaction; today it's three unguarded sequential in-memory writes.
- **Connection pooling**: PgBouncer or the platform's built-in pooler; Express app holds a single pool, not a connection per request.
- **Backups**: managed provider's automatic point-in-time recovery, enabled from day one of Phase 2 — never deferred to "later."
- **Migrations**: versioned, checked into `Artify-Backend/migrations/`, run in CI before deploy (see `IMPLEMENTATION_PLAN.md` Phase 2).

## 3. Schema families (maps directly to `TARGET_DOMAIN_MODEL` in `PHASE_0_AUDIT_REPORT.md`)

| Family | Core tables | Source of current shape |
|---|---|---|
| Identity | `users`, `roles`, `permissions`, `role_permissions`, `sessions` | **Phase 2 implemented in full**: `organizations` (renamed from `companies`, `ADR-010`), `users`, `organization_memberships`, `roles`, `permissions`, `role_permissions` (`ADR-011` — the join table deferred since Phase 1 is now real), `sessions` (hashed tokens), `audit_logs`, `webhook_events`. See `docs/DATABASE_SCHEMA.md` for the full column-level documentation. |
| Organizations | `organizations` | **Phase 2 implemented** — merged into the Identity family above; see `ADR-010`. |
| CRM | `leads`, `clients`, `contacts` | **Phase 2 implemented** (schema only — no CRM service/route layer yet, that's Phase 5). `opportunities`/`activities`/`tasks` from the original target model were not created — not needed by the Phase 2 brief's field lists and would have been speculative (§64 "do not overbuild"); add when a real workflow needs them. |
| Products | `products`, `product_modules` | **Phase 2 implemented** — a registry only, per §26/§27; no product business logic. |
| Commercial | `contracts`, `subscriptions`, `subscription_items`, `invoices`, `invoice_items` | **Phase 2 implemented** (schema only, no billing/payment integration — see `ADR-012` for the decimal-precision design). `api_keys`/`usage_events` from the original target model were not created in Phase 2 — deferred until the API-key management feature they'd support is actually built. |
| CMS | `pages`, `posts`, `categories`, `tags`, `authors`, `content_revisions`, `post_tags` | **Phase 2 implemented** (schema only, no CMS UI/API yet — Phase 8). See `docs/DATABASE_SCHEMA.md`'s CMS section for the revision-cycle and immutability design. |
| Media | `media_assets` | **Phase 2 implemented** (metadata only — object storage itself is Phase 9, §33). |
| Notifications | `notifications`, `notification_preferences` | **Phase 2 implemented** (schema only, no dispatch engine — Phase 13). |
| Configuration | `system_settings` | **Phase 2 implemented** — see `docs/DATABASE_SCHEMA.md` for the "always-owned-by-an-organization" design that avoids a nullable-scope uniqueness problem. |
| AI | `ai_coworkers`, `ai_tasks`, `ai_tool_calls`, `ai_approvals`, `ai_usage` | **Not yet implemented** — the AI governance *framework* exists (`server/ai/`, `ADR-007`) but its own tables were out of Phase 2's required domain list; add when Phase 12 builds real AI coworker persistence. |

## 4. Notable schema corrections vs. the prototype's implicit model
- `leads` — **implemented in Phase 2** as one unified table (`organization_id`-scoped), replacing the Phase 0 finding of three divergent in-memory shapes across the two repos. `source` is a free-text field rather than a controlled enum today (the Phase 0 prototype's `website_form`/`webhook`/`manual`/`api` distinction wasn't in the Phase 2 brief's minimal field list) — a low-risk follow-up if source-based reporting becomes a real requirement.
- `audit_logs` — **implemented in Phase 2** as append-only by application convention (single-method repository, `ADR-011`/`docs/DATABASE_SCHEMA.md`). A DB-role-level `REVOKE UPDATE, DELETE` grant (so not even a raw SQL bypass could alter history) remains a Phase 16 deployment-hardening step, not yet applied.
- `api_keys` — **not yet implemented**. The Phase 0 finding (unsalted-hash API keys in the prototype) doesn't yet have a Phase 2 replacement table, since API-key management wasn't in the Phase 2 brief's required domain list; when it is built, it must use the same real-hashing discipline as `sessions.token_hash` (`ADR-011`'s session addendum), not the prototype's SHA-256.

Entity-relationship diagrams are in `docs/DATABASE_SCHEMA.md`, generated from and kept in sync with the actual `prisma/schema.prisma` — not hand-drawn separately from it.
