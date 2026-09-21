# Implementation Roadmap — Phases 0-17

Each phase lists objective, dependencies, and the main workstreams. Detailed per-phase acceptance criteria live in `ACCEPTANCE_CRITERIA.md`. This roadmap assumes the REUSE/REFACTOR/REPLACE/REMOVE decisions in `MIGRATION_PLAN.md`.

## Phase 0 — Discovery & Audit ✅ (this document set)
Objective: evidence-based understanding of current state. Dependencies: none. Output: `CURRENT_STATE.md`, this roadmap, all other `/docs` files, ADRs, risk register. No source code changed.

## Phase 1 — Production Infrastructure
Objective: stand up the skeleton the rest of the work builds on, with nothing user-facing changed yet.
- Relocate `artifysolscom/server/{core,services,routes,ai,types}` into `Artify-Backend` (new top-level `platform/` or `server/` directory) per `INTEGRATION_ARCHITECTURE.md` §2.1.
- Add CI (typecheck, lint, `npm audit`) to both repos — currently absent entirely.
- Add environment-variable validation at boot (fail loudly, no insecure fallbacks — fixes S3/S4).
- Provision a Postgres instance (dev + staging) and an ORM (Prisma or Drizzle — decide via `ADR-002-database.md`).
- Security work: rotate the compromised `ARTIFY_WEBHOOK_SECRET`, remove all hardcoded secret fallbacks.
- Tests: none required to pass yet (none exist); this phase's job is to make Phase 2+ testable.

## Phase 2 — Database
Objective: real, persistent, transactional storage.
- Write the schema per `DATABASE_DESIGN.md` (identity, organizations, CRM, products, client platform, CMS, AI, platform families).
- Migration tooling wired into CI (migrations run before deploy).
- Convert `server/core/db.ts`'s `Map`-based store into repository classes backed by the ORM.
- Seed script derived from `seedData.ts`/`portalData.ts` (repurposed per `MIGRATION_PLAN.md`, with plaintext demo passwords replaced by hashed ones).
- Acceptance: every entity in `CURRENT_STATE.md` §3's data-source table has a real table; a server restart no longer loses data.

## Phase 3 — Authentication / RBAC
Objective: real, secure identity and authorization, end to end.
- Port `authService` middleware (`AUTHORIZATION_MODEL.md` §2), swap password hashing to bcrypt/argon2.
- Add the missing per-record ownership checks (`AUTHORIZATION_MODEL.md` §3.1).
- Add password reset, session revocation, login rate limiting (`SECURITY_MODEL.md`).
- Security test suite for horizontal/vertical escalation (`TESTING_STRATEGY.md` §4.3).
- **This phase does not yet remove either frontend's mock auth** — the real API must exist and be tested before anything depends on it.

## Phase 4 — Control Center (Artify-Backend UI rewire)
Objective: `AdminDataContext.tsx` and all `src/components/modules/*` call the real platform API instead of `seedData.ts`.
- Module-by-module cutover (Users, Roles, Leads, Products, Subscriptions, Audit Logs first — highest security relevance).
- Remove `switchUserRole()` and the `isAuthenticated`-defaults-true path once real login is wired.
- Regression: every module's CRUD still works, now against Postgres.

## Phase 5 — CRM
Objective: leads/opportunities are real, single-sourced.
- Unify the three divergent lead code paths (`artify-backend/server.ts`, `artifysolscom` legacy server, `server/v1/leadRoutes.ts`) into one, per `INTEGRATION_ARCHITECTURE.md` §2.3.
- Fix webhook signature verification (`SECURITY_MODEL.md` S3) with regression test.
- Lead auto-triage logic ported and tested.

## Phase 6 — Client Onboarding
Objective: real tenant/company registration flow (`authService.register` already models this — harden and expose via UI).
- Company creation, initial admin user, trial subscription — transactionally (fixes the unguarded multi-write in `authService.ts:100-201`).

## Phase 7 — Products
Objective: product/service catalog is real and shared between marketing site and Control Center (today duplicated across `seedData.ts`, `aiProductsData.ts`, `solutionsData.ts`, and `server/core/db.ts`'s 2 seed products).
- Single product table, both frontends read from it.

## Phase 8 — CMS
Objective: blog/pages are real, with the existing revision/SEO/publish-approval concepts (`ArticleRecord.provenance`, `seo`) fully wired.
- Retire `blogData.ts` localStorage CMS.
- AI-authored drafts (via `coworkerService`) flow into the same table with `provenance.createdByType: 'ai'`.

## Phase 9 — Media
Objective: real object storage (S3-compatible) replacing metadata-only client state.
- Signed upload URLs, size/type validation (`SECURITY_MODEL.md` "File uploads").

## Phase 10 — Billing / Client Portal
Objective: subscriptions/invoices/API keys/payment methods are real.
- Payment provider integration is a separate decision (no processor exists today) — this phase wires subscription/invoice records and API-key issuance to the real backend; actual card processing is scoped and decided via its own ADR before implementation.
- Retire all `AuthContext.tsx` fabrication for these entities.

## Phase 11 — Public Website Integration
Objective: `artifysolscom`'s marketing site and Client Portal fully consume the platform API; no server-side business logic remains in `artifysolscom` beyond static serving/sitemap.
- Remove the legacy duplicated Express entrypoints' bespoke logic (`INTEGRATION_ARCHITECTURE.md` §2.3).
- CORS allow-list finalized between the two deployed domains.

## Phase 12 — AI Control Center
Objective: `AiControlCenterModule.tsx` (admin) and `InteractiveAiConsultant.tsx`/`SolutionBuilderWizard.tsx` (public) both run against the real `coworkerService`/`aiRoutes` — one Gemini integration, one model constant, cost/usage tracking wired to `AiCoworker.metrics`.

## Phase 13 — Notifications / Jobs / Integrations
Objective: `notificationService` dispatch is real (Slack/email), not `{ sent: true }`; third-party integrations shown in the Integrations module (`seedData.ts` fake keys) become real, actually-called SDKs or are removed from the UI until implemented.
- Background job runner introduced for AI coworker `schedule.cronExpression` execution (currently modeled in data but nothing executes it).

## Phase 14 — Reporting
Objective: `ReportsModule.tsx`/`AnalyticsModule.tsx` read real aggregated data instead of hand-authored numbers.

## Phase 15 — Security / QA
Objective: close every remaining item in `SECURITY_MODEL.md`, stand up the full testing pyramid (`TESTING_STRATEGY.md`), enable `tsconfig` `strict` mode across both repos, CI gates on all of the above.

## Phase 16 — Production Deployment
Objective: both repos deploy through the hardened pipeline with migrations, health checks that test real dependencies, rollback plan, staging environment mirroring production.

## Phase 17 — Final Production Readiness
Objective: walk `PRODUCTION_READINESS_CHECKLIST.md` end to end, sign-off, remove any remaining "demo mode" affordances, tag a v1.0 release.

## Cross-phase dependency summary
```
Phase 0 → 1 → 2 → 3 → {4, 5, 6, 7} → {8, 9, 10} → 11 → 12 → 13 → 14 → 15 → 16 → 17
```
4-7 can proceed in parallel once 3 (auth) lands, since each is a separate module cutover against the same platform API. 8-10 similarly parallelize once 4-7's patterns are established. 15 (security/QA) is continuous in practice, not a single terminal phase — but a dedicated hardening pass before 16 is still required.
