# API Design

> **Phase 2 update**: `/api/v1/auth/*` now runs against the real Prisma/Postgres schema (`organizations`, `role_permissions` — `ADR-010`/`ADR-011`), and a new `GET /api/v1/system/database` endpoint (SUPER_ADMIN-only) reports migration status and table counts without exposing connection details — see `docs/DATABASE_SCHEMA.md` and `docs/PHASE_2_COMPLETION_REPORT.md`. The other endpoint groups in §3 below (`/organizations`, `/users`, `/roles`, `/leads`, `/products`, `/subscriptions`, `/cms`, `/ai/*`, `/notifications`, `/api-keys`) remain **not implemented** — Phase 2 built their database schema only (`docs/DATABASE_SCHEMA.md`), not their routes/services. `companyId` is renamed `organizationId` throughout wherever it appears below.

## 1. Reuse baseline
`artifysolscom/server/core/apiResponse.ts` already defines a solid envelope — keep it as-is when the router layer moves into `Artify-Backend`:
```ts
{ success: boolean, data?: T, error?: { code, message, details, requestId }, meta: { requestId, timestamp, pagination? } }
```
`ApiErrorCode` enum (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`, `RESOURCE_CONFLICT`, `RATE_LIMIT_EXCEEDED`, `AI_EXECUTION_ERROR`, `AI_APPROVAL_REQUIRED`, `INSUFFICIENT_QUOTA`, `TENANT_ISOLATION_ERROR`, `INTERNAL_ERROR`) is already comprehensive — extend, don't replace.

## 2. Versioning
Keep the existing `/api/v1` prefix convention (`server/routes/v1/index.ts`). Additive-only within v1 (new optional fields, new endpoints); a breaking change gets `/api/v2` mounted alongside v1, not an in-place break. No versioning strategy exists in the prototype beyond the folder name — this makes it a real policy.

## 3. Endpoint groups (target — supersedes the duplicated/legacy endpoints documented in `CURRENT_STATE.md`)

| Group | Base path | Replaces |
|---|---|---|
| Auth & sessions | `/api/v1/auth/*` | `server/routes/v1/authRoutes.ts` (reused), fake `AuthContext.login/register` (removed) |
| Organizations & membership | `/api/v1/organizations/*` | New — currently implicit in `Company` |
| Users & RBAC | `/api/v1/users/*`, `/api/v1/roles/*` | `UsersModule.tsx`/`RolesModule.tsx` mock CRUD (removed), backed by real table |
| CRM (leads/opportunities) | `/api/v1/leads/*`, `/api/v1/opportunities/*` | `leadRoutes.ts` (reused/extended), `artify-backend/server.ts` webhook leads (migrated in, fixed) |
| Products & plans | `/api/v1/products/*`, `/api/v1/plans/*` | `productRoutes.ts` (reused/extended) |
| Subscriptions & billing | `/api/v1/subscriptions/*`, `/api/v1/invoices/*`, `/api/v1/payments/*` | `subscriptionRoutes.ts` (reused/extended), fabricated invoice logic in `AuthContext.tsx` (removed) |
| API keys | `/api/v1/api-keys/*` | `subscriptionRoutes.ts` `apiKeyRouter` (reused, add ownership checks) |
| CMS | `/api/v1/cms/*`, `/api/v1/pages/*`, `/api/v1/media/*` | `cmsRoutes.ts` (reused/extended), `blogData.ts` localStorage CMS (removed) |
| AI Control Center | `/api/v1/ai/coworkers/*`, `/api/v1/ai/tasks/*`, `/api/v1/ai/consultant` | `aiRoutes.ts` (reused), `artify-backend`'s `/api/ai/generate` (removed), legacy `/api/ai-consultant` + `/api/v1/ai/consultant` duplication (merged into one) |
| Notifications & webhooks | `/api/v1/notifications/*`, `/api/v1/webhooks/*` | `notificationRoutes.ts` (reused), `artify-backend/server.ts` webhook handling (migrated in, signature fixed) |
| Audit | `/api/v1/audit/*` | `auditRouter` (reused) |
| System | `/api/v1/system/health`, `/api/v1/system/status`, `/api/v1/system/database` (Phase 2, SUPER_ADMIN-only) | `systemRoutes.ts` (reused, health check corrected to test real DB connectivity instead of always reporting healthy; `/database` added Phase 2 for migration-status verification) |

## 4. Standards applied to every route (gap in the prototype — see `CURRENT_STATE.md` API tables)
1. Every mutating route: `authenticateToken` → `requirePermission(...)` → **ownership/tenant check on the specific record**, not just "caller has the permission somewhere" (fixes the gaps found in `PUT /cms/articles/:id`, `POST/DELETE /api-keys`, `POST /notifications/:id/read`, `PUT /ai/coworkers/:id`).
2. Every route: zod schema validation of `body`/`query`/`params` before the handler runs (none exists today — handlers do ad-hoc `if (!x)` checks).
3. Every mutating route: an audit-log write (today only login and a couple of others do this).
4. List routes: consistent `page`/`limit`/`total` pagination (already partially modeled in `apiResponse.ts`'s `meta.pagination` — just apply it everywhere, including `GET /leads`, `GET /ai/tasks`, which don't set it consistently today).
5. Public/anonymous routes explicitly documented as such (lead intake, product catalog, article reading, sitemap/robots/health) vs. everything else requiring a session — this distinction already exists informally; formalize it as an explicit route metadata flag so a missing `authenticateToken` is a lint-time error, not a silent gap.

## 5. Removed surface
The duplicated legacy marketing server (`artifysolscom/server.ts` + `api/index.ts`'s bespoke `/api/ai-consultant`, `/api/brief-submit`) is merged into `/api/v1/ai/consultant` and `/api/v1/leads` respectively — one implementation, one Gemini model constant, not two drifting copies (see `CURRENT_STATE.md` §2.6 for the drift evidence).
