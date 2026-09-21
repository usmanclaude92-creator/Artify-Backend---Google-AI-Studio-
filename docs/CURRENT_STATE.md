# Current State — Artify Solutions (Phase 0 Audit)

Evidence-based inventory of what exists today across both repositories. All claims are cited to file paths (and line numbers where useful) as verified by direct inspection on 2026-09-19.

Repos audited:
- **Artify-Backend** (`usmanclaude92-creator/Artify-Backend`) — intended future Control Center / Admin Platform.
- **artifysolscom** (`usmanclaude92-creator/artifysolscom`) — public website + Client Portal.

Both are React 19 + Vite 6 + TypeScript + Express single-process apps scaffolded from a Google AI Studio "Build" template (`metadata.json` → `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` in both repos; `artifysolscom/package.json`'s `name` is still the template default `"react-example"`). Neither repo's business content is about art/NFT/Solana — both simulate **"Artify Solutions"**, a fictional enterprise-AI-automation vendor.

---

## 1. Repository A — Artify-Backend

### 1.1 What it actually is
A single-page React admin console ("Super Admin Control Center") with 20+ UI modules (Users, Roles, Leads, Products, Blog, SEO, Security, Audit Logs, Subscriptions, Integrations, AI Control Center, System Health, Reports, Settings, Website/CMS, etc. — `src/components/modules/*.tsx`) plus a duplicate of the public marketing site (`src/components/website/PublicWebsiteView.tsx`).

### 1.2 Backend / data reality
**There is no backend and no database.** `server.ts` (737 lines) is an Express app that exists only to: serve the Vite/React bundle, proxy a handful of demo endpoints to Gemini, and hold a few **in-memory arrays that reset on every restart** (`serverAuditLogs`, `telemetryEvents`, `serverLeads`, `serverWebhookEvents`). All of the data an admin actually sees — users, roles, leads, products, subscriptions, audit history — is hardcoded in `src/data/seedData.ts` (~1,600 lines) and loaded into `AdminDataContext.tsx` (~1,175 lines) as React state, optionally mirrored to `localStorage` under the `artify_super_admin_v2*` key prefix.

`GET /api/health` unconditionally returns `"database": "connected"` even though no database driver exists anywhere in `package.json`. `GET /api/system/stats` returns partly fabricated numbers (hardcoded `activeConnections: 18`, `cacheHitRate: 98.4`).

### 1.3 Authentication / authorization — status: **MOCKED / INSECURE**
- `AdminDataContext.tsx:174` — `isAuthenticated` state defaults to `true`.
- `login(email?, role?)` never checks a password; the type itself has no password field anywhere in `seedData.ts`/`types.ts`.
- `switchUserRole()` (`AdminDataContext.tsx:480-493`) lets any browser tab instantly become any role in the system — explicitly commented as a "Role Switcher for testing RBAC," with **no server-side check of any kind**, because there is no server-side auth layer at all.
- RBAC (`rbacMatrix: RbacMatrixItem[]`) only decides what renders in the UI; it enforces nothing, because every `/api/*` route in `server.ts` is unauthenticated.

### 1.4 Webhook security — status: **INSECURE (broken-by-design signature check)**
`server.ts:190`: `const WEBHOOK_SECRET = process.env.ARTIFY_WEBHOOK_SECRET || "artify_whsec_prod_2026_soc2"` — a non-empty literal fallback secret, shipped in `.env.example` as the same value (not a placeholder).
`server.ts:423-430`:
```ts
const tokenHeader = req.headers["x-artify-webhook-token"] || req.query.token;
let isVerified = true;
if (tokenHeader && tokenHeader !== WEBHOOK_SECRET) {
  isVerified = false;
}
```
Omitting the header entirely leaves `isVerified = true` — the check only ever *rejects* an explicitly wrong token, never a missing one. This is not a functioning signature check.

### 1.5 API surface (`server.ts`, no router files, no auth middleware anywhere)
| Method | Route | Purpose | Auth | Persistence | Status |
|---|---|---|---|---|---|
| GET | `/api/health` | Fabricated health payload | None | — | MOCKED |
| GET | `/api/system/stats` | Process stats + fake metrics | None | — | PARTIALLY MOCKED |
| POST | `/api/ai/generate` | Gemini passthrough (`gemini-3.8-flash`, non-existent model id) with canned fallback | None | — | IMPLEMENTED (external call), fallback MOCKED |
| GET/POST | `/api/audit-logs` | In-memory audit log | None | In-memory (volatile) | PARTIAL |
| POST | `/api/analytics/event` | Telemetry sink, capped at 1000 events | None | In-memory (volatile) | PARTIAL |
| POST | `/api/webhooks/leads` | Lead ingestion + auto-triage | Broken (see 1.4) | In-memory (volatile) | INSECURE |
| GET | `/api/webhooks/leads` | List recent webhook events | None | In-memory (volatile) | PARTIAL |
| POST | `/api/webhooks/test` | Generates fake demo leads | None | — | MOCKED |
| GET/POST | `/api/leads` | List/create leads | None | In-memory (volatile) | PARTIAL |
| POST | `/api/notifications/dispatch` | "Sends" Slack/email | None | — | MOCKED (always returns `sent:true`, dispatches nothing) |

### 1.6 Third-party integrations
- **Google Gemini** — the only real external call (`@google/genai`), model string `gemini-3.8-flash` does not correspond to a real published model.
- Stripe, SendGrid, Twilio, Google Analytics, GCS — **UI-only**: `seedData.ts` (~lines 1470-1531) defines `initialIntegrations` with fake masked keys purely for display; no SDK for any of them is a dependency.
- No storage integration (S3/Cloudinary): the Media module stores only metadata client-side.

### 1.7 Quality signals
- No tests, no ESLint/Prettier, `"lint"` = `tsc --noEmit` with no `strict` flag set.
- No `.github/workflows`, no Dockerfile, no hosting config of any kind.
- Webhook secret hardcoded client-side too (`AdminDataContext.tsx:607`), i.e. shipped in the browser bundle.

---

## 2. Repository B — artifysolscom

### 2.1 What it actually is
The public marketing site (~45 landing-page section components) plus a "Client Portal" (dashboard, subscriptions, invoices, API keys, SEO health — `src/components/portal/*`) plus a mocked blog/CMS editor (`src/components/blog/*`).

### 2.2 The critical finding: **two backends, only one of which the frontend uses**

This repo contains a genuinely well-structured Express API under `server/` — routers, services, an `AuthService` with real password-hash comparison, session tokens, granular RBAC middleware, and tenant-isolation middleware (see `AUTHORIZATION_MODEL.md`). **The frontend calls almost none of it.**

Real network calls found in `src/` (grep-verified, exhaustive):
1. `InteractiveAiConsultant.tsx:220` → `POST /api/ai-consultant` (goes to the *other*, throwaway `server.ts`/`api/index.ts`, not `/api/v1/ai/consultant` in `server/`)
2. `ContactAndBrief.tsx:80` → `POST /api/brief-submit` (same throwaway server, not `/api/v1/leads`)
3. `PortalSeoHealth.tsx:334` → `GET /api/v1/cms/seo-telemetry` (the only real `server/` call)
4. `PortalSeoHealth.tsx:367` → `POST /api/v1/cms/optimize-meta` (the only other real `server/` call)

Everything else in the Client Portal — login, register, subscriptions, invoices, API keys, purchased products — is **entirely fabricated in `src/context/AuthContext.tsx`** and never touches the network (see §2.3). The `server/v1` routes for auth, CMS article CRUD, products, subscriptions, leads, notifications, audit, and AI coworkers are **fully implemented but effectively dead code from the product's point of view** — nothing in the UI signs in through them, creates a real lead through them, or manages a real subscription through them.

### 2.3 Authentication (frontend) — status: **MOCKED**
`src/context/AuthContext.tsx:117-134` — `login(email, _password?, demoKey?)`:
- The `_password` parameter is prefixed with an underscore and **never read**.
- Any email that doesn't match a demo user fabricates a brand-new `UserProfile` on the spot — full name derived from the email's local-part, a fake company, a fake Visa card, a fake active subscription, a fake paid invoice, a fake session record, a fake successful "login" security event (`AuthContext.tsx:141-301`).
- `register()` behaves identically — no email verification, no uniqueness check, no server round-trip (`AuthContext.tsx:309-464`).
- Session persistence is two `localStorage` keys holding the entire fabricated profile in plaintext (`artify_auth_user_session`, `artify_auth_user_intentionally_logged_in`).

### 2.4 Authentication (the unused real backend) — status: **IMPLEMENTED but weak in one place**
`server/services/authService.ts`:
- `login()` (lines 28-95) genuinely hashes the submitted password and compares it to the stored hash (`db.hashPassword(password) === foundUser.passwordHash`), rejects wrong credentials and non-active accounts, issues a `crypto.randomBytes(32)`-based bearer token with a 24h TTL, and writes an audit-log entry.
- `authenticateToken` / `optionalAuthenticate` / `requirePermission` / `requireRole` / `enforceTenantIsolation` middleware (lines 235-367) are real, sensible, and consistently applied across every sensitive route in `server/routes/v1/*`.
- **Weakness**: `db.hashPassword()` (`server/core/db.ts:47-49`) is unsalted `crypto.createHash('sha256')` — fast, unsalted, and vulnerable to rainbow-table/brute-force attack if this DB were ever real. Not production-grade regardless of persistence layer.
- Seed users ship with **real-looking plaintext passwords in source** (`db.ts:136,152,181` — e.g. `'ArtifyAdmin2026!'`), fine for a demo fixture but must never carry into a real seed script.

### 2.5 Full API surface of the real backend (`server/routes/v1/*`, mounted at `/api/v1` in `server.ts:37`)

| Method | Route | Purpose | Auth | Permission | Tenant-scoped | Validation | Audit | Used by frontend? |
|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | Login | No | — | — | Basic presence check | Yes | **No** |
| POST | `/api/v1/auth/register` | Register tenant + admin | No | — | — | Basic presence check | No | **No** |
| GET | `/api/v1/auth/me` | Current user/company | Yes | — | Implicit | — | No | **No** |
| POST | `/api/v1/auth/logout` | Revoke session | No (token optional) | — | — | — | No | **No** |
| GET | `/api/v1/cms/articles` | List articles | Optional | — | Yes (non-admin) | — | No | **No** |
| GET | `/api/v1/cms/articles/:id` | Get one article | No | — | No | — | No | **No** |
| POST | `/api/v1/cms/articles` | Create article | Yes | `blog.create` | Yes | Title/category/content required | No | **No** |
| PUT | `/api/v1/cms/articles/:id` | Update article | Yes | `blog.update` | No (no ownership re-check) | No | No | **No** |
| POST | `/api/v1/cms/articles/:id/publish` | Publish article | Yes | `blog.publish` | No | — | No | **No** |
| GET | `/api/v1/cms/seo-telemetry` | SEO dashboard data | Optional | — | — | — | No | **Yes** |
| POST | `/api/v1/cms/optimize-meta` | Gemini meta-tag generator | Optional | — | — | Title required | No | **Yes** |
| GET | `/api/v1/products` | List products | No | — | — | — | No | **No** |
| GET | `/api/v1/products/:id` | Get product | No | — | — | — | No | **No** |
| POST | `/api/v1/products` | Create product | Yes | `products.manage` | No | Service-level | No | **No** |
| GET | `/api/v1/subscriptions/current` | Current subscription | Yes | `subscriptions.view` | Yes (own company only) | — | No | **No** |
| GET | `/api/v1/api-keys` | List API keys | Yes | — | Yes (own company) | — | No | **No** |
| POST | `/api/v1/api-keys` | Create API key | Yes | — (any authenticated user) | Yes | Name required | No | **No** |
| DELETE | `/api/v1/api-keys/:id` | Revoke key | Yes | — (any authenticated user) | Yes | — | No | **No** |
| POST | `/api/v1/leads` | Public lead intake | No | — | — | 4 fields required | No | **No** |
| GET | `/api/v1/leads` | Internal CRM lead list | Yes | `leads.view` | No (no companyId filter applied) | — | No | **No** |
| GET | `/api/v1/notifications` | List notifications | Yes | — | Yes | — | No | **No** |
| POST | `/api/v1/notifications/:id/read` | Mark read | Yes | — | No (no ownership check) | — | No | **No** |
| GET | `/api/v1/audit` | Audit log query | Yes | `audit.view` | Yes (non-admin) | — | — | **No** |
| GET | `/api/v1/ai/coworkers` | List AI agents | Yes | `ai.agents.view` | Yes (non-admin) | — | No | **No** |
| GET | `/api/v1/ai/coworkers/:id` | Get agent | Yes | `ai.agents.view` | No | — | No | **No** |
| PUT | `/api/v1/ai/coworkers/:id` | Update agent | Yes | `ai.agents.configure` | No | No | No | **No** |
| POST | `/api/v1/ai/coworkers/:id/execute` | Run agent task | Yes | `ai.agents.execute` | Implicit via body | title/prompt required | No | **No** |
| GET | `/api/v1/ai/tasks` | List tasks | Yes | `ai.tasks.view` | Yes (non-admin) | — | No | **No** |
| POST | `/api/v1/ai/tasks/:id/approval` | Approve/reject AI action | Yes | `ai.tasks.approve` | No | decision enum-checked | No | **No** |
| POST | `/api/v1/ai/consultant` | AI architecture chat | Optional | — | — | `problem` required | No | **No** (UI calls the legacy `/api/ai-consultant` instead) |
| GET | `/api/v1/system/health` | Deep diagnostics | No | — | — | — | No | **No** |

Notable gaps even within this well-built router set: **no ownership/ID-scoping check on `PUT /cms/articles/:id`, `POST /api-keys`, `DELETE /api-keys/:id`, `POST /notifications/:id/read`, `PUT /ai/coworkers/:id`** — `requirePermission` confirms the caller *has the permission somewhere*, but several handlers don't additionally verify the target record belongs to the caller's `companyId`. This is a horizontal-privilege-escalation risk once real multi-tenant data exists (see `SECURITY_MODEL.md`).

### 2.6 The legacy marketing-only server (duplicated & drifting)
Two more Express entrypoints exist purely to serve the public site's AI-consultant widget, sitemap/robots, and health checks — **not part of `server/`, and not versioned**:
- `server.ts` (Railway/Docker target) — Gemini model `gemini-3.7-flash` (`server.ts:128`)
- `api/index.ts` (Vercel serverless target) — Gemini model `gemini-2.5-flash` (`api/index.ts:102`)

These implement `/api/health`, `/api/ai-consultant`, `/api/brief-submit`, `/sitemap.xml`, `/robots.txt` **twice, independently**, and have already drifted (different model IDs). `server.ts:177` / `api/index.ts:151` log raw lead PII (name, company, email) to stdout unredacted on every brief submission.

### 2.7 Payments / billing — status: **entirely fabricated**
No Stripe or any payment SDK in `package.json`. All invoices, payment methods (card brand/last4/expiry), and subscription state live only in `AuthContext.tsx`'s in-memory/`localStorage` user object. `updatePaymentMethod()` accepts and stores any typed-in card data with zero validation or gateway call.

### 2.8 Deployment
- Vercel (`vercel.json`) and Railway/Docker (`railway.json` + `Dockerfile`, Node 20-alpine) are both configured and both point at **different server entrypoints** (§2.6).
- `bun.lock` is committed but the Dockerfile and `package.json` scripts use `npm` — lockfile/installer mismatch.
- No `.github/workflows` — nothing gates a deploy on a build, type-check, or test passing.

### 2.9 Quality signals
- No tests anywhere in either repo.
- `tsconfig.json` (both repos, byte-identical) sets no `strict` flag.
- `"lint"` = `tsc --noEmit` in both repos — there is no actual lint tool.
- One `ErrorBoundary.tsx` component exists and is used — a genuine positive.
- Redundant animation dependencies: `framer-motion` and `motion` both present in `artifysolscom/package.json`.

---

## 3. Data-Source Inventory (both repos combined)

| Entity | Current source | Persistent? | Authoritative? | Production-ready? |
|---|---|---|---|---|
| Users (portal) | `AuthContext.tsx` fabricated on login | localStorage only | No | No |
| Users (admin console) | `seedData.ts` hardcoded array | localStorage mirror | No | No |
| Users (real backend) | `server/core/db.ts` in-memory `Map`, SHA-256 unsalted hash | No (resets on restart) | Conceptually yes, but unused | No |
| Roles / permissions | `seedData.ts` (admin UI) + `server/types/index.ts` (real, unused) | No / No | No | No |
| Organizations / tenants | `server/core/db.ts` (2 seed companies) | No | Conceptually yes, unused | No |
| Leads | 3 independent places: `artify-backend/server.ts` in-memory array, `artifysolscom/server.ts`+`api/index.ts` (console.log only, no storage), `artifysolscom/server/core/db.ts` `leads` Map (unused) | No / No / No | No | No |
| Products / services | `seedData.ts` (admin) + `src/data/*.ts` (marketing) + `server/core/db.ts` (2 seed products, unused) | No | No | No |
| Subscriptions | `AuthContext.tsx` fabricated + `server/core/db.ts` (unused) | localStorage / No | No | No |
| Invoices | `AuthContext.tsx` fabricated, `Math.random()` IDs | localStorage only | No | No |
| API keys | `AuthContext.tsx` fabricated (masked, never validated) + `server/core/db.ts` (unused, real hash-based) | localStorage / No | No | No |
| Blog / CMS articles | `blogData.ts` (marketing, localStorage) + `server/core/db.ts` `articles` Map (unused, real) | localStorage / No | No | No |
| Audit logs | `artify-backend/server.ts` in-memory array + `server/core/db.ts` `auditLogs` array (unused, real) | No / No | No | No |
| AI coworkers / tasks | `server/core/db.ts` (real, structured, unused by UI) + `AiControlCenterModule.tsx` (admin, seed data) | No / No | No | No |
| Dashboard metrics | Hand-authored numbers in `seedData.ts` / `portalData.ts` / route handlers | No | No | No |

**Bottom line: no entity in either repository has real, durable, authoritative persistence today.** Everything is `localStorage`, in-memory (server-restart-volatile), or static seed data.
