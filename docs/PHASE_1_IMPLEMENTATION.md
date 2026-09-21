# Phase 1 — Production Infrastructure & Development Foundation

Implementation notes for Phase 1, scoped exactly to `docs/IMPLEMENTATION_PLAN.md`'s Phase 1: infrastructure, not business modules. For the outcome/status report, see `docs/PHASE_1_COMPLETION_REPORT.md`. For day-to-day usage, see `docs/DEVELOPMENT_SETUP.md`, `docs/ENVIRONMENT_CONFIGURATION.md`, `docs/DATABASE_SETUP.md`.

## What changed, and why

### 1. Repository structure
A new `server/` tree holds the canonical Platform API, mirroring the shape the brief suggested but adapted to this repo's reality: `src/` was already reserved for the Vite/React frontend, so the backend lives in a top-level `server/` directory instead (matching the convention the reused code came from in `artifysolscom/server/`), not nested under `src/`.

```
server/
├── app/app.ts            # Express app assembly (middleware order, route mounting)
├── config/env.ts         # Centralized, zod-validated environment config
├── core/                 # apiResponse envelope, typed AppError hierarchy, pino logger
├── db/                   # Prisma client singleton, real health checks
├── middleware/            # requestId, security (helmet/CORS/body limits), rateLimiter, auth/RBAC, errorHandler
├── repositories/           # Prisma query wrappers (user, company, session, auditLog, webhookEvent)
├── services/               # authService, webhookService — business logic, no Express types
├── routes/v1/              # authRoutes, webhookRoutes, systemRoutes — HTTP-only, delegates to services
├── schemas/                 # zod input-validation schemas
├── types/                   # domain.ts (identity types), express.d.ts (Request augmentation)
└── ai/                       # provider.ts (Gemini wrapper), tools.ts (governance framework, no tools registered yet)
```

`server.ts` (repo root) is the bootstrap: validates config, mounts the API app, adds frontend serving (Vite dev middleware / static `dist` — unchanged from before), verifies the DB is reachable, listens, and shuts down gracefully on SIGTERM/SIGINT.

### 2. What was ported vs. built new (see `docs/MIGRATION_PLAN.md` for the full REUSE/REFACTOR/REPLACE/REMOVE breakdown)
- **Ported near-verbatim** (already sound design, per the Phase 0 audit): the `apiResponse` envelope and `ApiErrorCode` enum, the `authenticateToken`/`optionalAuthenticate`/`requirePermission`/`requireRole`/`enforceTenantIsolation` middleware chain, the AI tool-sandbox pattern's shape (registry + executor + audit-on-every-call).
- **Hardened during the port**: password hashing (unsalted SHA-256 → bcryptjs), sessions (in-memory `Map` → Postgres via Prisma), registration (three unguarded sequential writes → one DB transaction), webhook verification (inverted/broken → HMAC + timestamp + idempotency).
- **Built new**: the config validation layer, the Prisma schema/migrations, the repository layer (didn't exist before — `server/core/db.ts` was both store and query API), structured logging, request correlation, centralized error handling, rate limiting, the CI workflows, the entire test suite (58 tests — none existed before).

### 3. Deliberate Phase 1 scope boundaries
Per the brief's non-goals list, none of the following were built, only the infrastructure they'll need: CRM, client onboarding, product catalog, CMS, media library, subscriptions/billing, the full client portal, AI autonomous workflows, reporting, notification center. Concretely:
- `server/ai/tools.ts`'s tool registry is intentionally empty — the governance *pattern* is proven (permission-gated, audit-logged, no arbitrary execution), no business tool is implemented.
- `server/routes/v1/index.ts` mounts only `auth`, `webhooks`, `system` — no `cms`, `products`, `subscriptions`, `leads` (business), `ai`, `notifications`, `audit` route groups yet.
- The webhook route proves signature verification + idempotent recording end-to-end; it does not implement CRM auto-triage (that logic still exists only in the old `artify-backend/server.ts`, itself now retired — see §5).

### 4. False production signals removed (§26)
- `artify-backend/server.ts`'s fake `/api/health` (`"database": "connected"` with no database existing) — replaced by `server/routes/v1/systemRoutes.ts`'s `/live` + `/ready`, the latter performing a real, timed `SELECT 1`.
- The hardcoded, compromised webhook secret (`artify_whsec_prod_2026_soc2`) — removed from `server.ts`'s insecure fallback and from `AdminDataContext.tsx`'s client bundle (see `docs/SECURITY_CONFIGURATION.md`).
- The admin console's and client portal's fabricated-auth UIs are **not yet rewired** (that's Phase 4/11) — instead, both now carry a visible "Demo Data / Demo Account" label (`AdminHeader.tsx`, `artifysolscom/src/components/portal/ClientPortal.tsx`) so they stop silently presenting as real, per the brief's "clearly represent as unavailable rather than pretending it works" instruction.

### 5. What was retired
`artify-backend/server.ts`'s entire previous route set (`/api/ai/generate`, `/api/audit-logs`, `/api/webhooks/*` with the broken signature check, `/api/leads`, `/api/notifications/dispatch`, `/api/system/stats`) is gone, superseded by `server/routes/v1/*`. The admin console's calls to those old paths (`AdminDataContext.tsx`) now point at the new namespace or 404 gracefully into their existing local-fallback code paths — see `docs/PHASE_1_COMPLETION_REPORT.md` "Frontend Integration" for the exact list and why a full rewire is Phase 4, not Phase 1.

### 6. `artifysolscom` changes
Minimal, per the brief: a frontend API client abstraction (`src/lib/apiClient.ts`, unused by existing screens by design — Phase 4/11 wires it up), a `Demo Account` label on the Client Portal, a `server/README.md` marking that directory as scheduled for relocation into this repo, dependency cleanup (removed the unused `motion` package, dropped `bun.lock` in favor of npm to match the existing Dockerfile, removed the now-redundant `nixpacks.toml`), and a matching CI workflow.

## Environment variable rename
`ARTIFY_WEBHOOK_SECRET` → `WEBHOOK_SECRET`. Deliberate breaking rename, not an oversight: the old variable's committed default value is compromised (Phase 0 finding S3/S4), and keeping the same variable name risked a deployment silently continuing to use that value if the new secret were never actually set. A fresh name forces every environment to set a fresh value. See `docs/ENVIRONMENT_CONFIGURATION.md`.

## Local sandbox note (transparency, not a design decision)
During this build, local verification used a locally-installed Postgres instance rather than the hosted Postgres project supplied partway through the session — this sandbox's network egress is allow-listed and doesn't reach arbitrary external hosts (verified: a raw TCP probe to the hosted instance's port times out, and even a plain HTTPS request to the provider's own site is rejected by the egress proxy with 403). This is a property of this execution environment, not of the code: `server/config/env.ts` and `prisma/schema.prisma` are provider-agnostic, and CI (`docs/CI_CD.md`) runs against a real Postgres service container. See `docs/PHASE_1_COMPLETION_REPORT.md` "Database" for the precise, honest status.
