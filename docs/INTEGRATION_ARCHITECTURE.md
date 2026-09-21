# Repository Integration Strategy

## 1. Target relationship

```
Artify-Backend  →  authoritative Platform API + Control Center UI  (source of truth for users, clients,
                    organizations, products, subscriptions, invoices, CMS data, API keys, permissions)
artifysolscom   →  Public Website + Client Portal UI  (consumes Platform API only — no independent DB)
```

This matches the brief's own framing and is formalized in `ADR/ADR-001-platform-boundary.md`.

## 2. What actually has to move, precisely

The counter-intuitive part: **the real, usable backend code is currently in `artifysolscom/server/`, not in `Artify-Backend`.** `Artify-Backend/server.ts` today has no auth, no RBAC, no persistence model at all (`CURRENT_STATE.md` §1.2-§1.4). So "integration" here is not two peers linking up — it's:

1. **Relocate** `artifysolscom/server/{core,services,routes,ai,types}` into `Artify-Backend` as the platform API's foundation (auth, RBAC, tenant isolation, CMS, products, subscriptions, leads, notifications, AI coworkers are already modeled there — see `AUTHORIZATION_MODEL.md` for what to keep as-is vs. harden).
2. **Retire** `Artify-Backend/server.ts`'s current ad-hoc demo routes (`/api/ai/generate`, `/api/audit-logs`, `/api/webhooks/*`, `/api/leads`, `/api/notifications/dispatch`) — their functionality is superseded by the relocated `server/v1` routes, once the webhook signature bug is fixed and lead auto-triage logic (`artify-backend/server.ts:347-411`) is ported into `leadService`.
3. **Retire** `artifysolscom`'s duplicated legacy marketing server (`server.ts` + `api/index.ts`'s bespoke `/api/ai-consultant`, `/api/brief-submit`) in favor of calling the relocated platform's `/api/v1/ai/consultant` and `/api/v1/leads` — one implementation instead of two drifting ones.
4. **Rewire** `artifysolscom`'s frontend: `AuthContext.tsx` stops fabricating users and instead calls `Artify-Backend`'s `/api/v1/auth/*`; the Client Portal's subscriptions/invoices/API-keys/products screens switch from `AuthContext` local state to real fetches against the platform.
5. **Rewire** `Artify-Backend`'s own admin console: `AdminDataContext.tsx` stops reading `seedData.ts` and calls the same platform API it now hosts (internally, or same-origin) for every module.

## 3. Deployment topology
- `Artify-Backend` deploys as the platform API (Railway, given existing `railway.json`/`Dockerfile` patterns in `artifysolscom` — mirror that config into `Artify-Backend`) **and** serves the Control Center UI as its static frontend (same pattern as today: Express + Vite build).
- `artifysolscom` continues to deploy independently (Vercel and/or Railway, per its existing dual config) but with **zero server-side business logic left** beyond static serving, sitemap/robots generation, and a thin reverse-proxy/CORS-safe fetch layer to the platform API if same-origin isn't achievable.
- Domains: `api.artifysols.com` (or `admin.artifysols.com/api`) for the platform API, `artifysols.com` for the public site — CORS allow-list configured explicitly between them (today: no CORS policy exists at all).

## 4. Authentication handoff
- Single identity provider: the platform API's `/api/v1/auth/*`.
- Both frontends store the same bearer session-token shape and send `Authorization: Bearer <token>` to the platform API.
- Cross-subdomain session sharing (if `admin.artifysols.com` and `artifysols.com` both need a signed-in state) requires either a shared parent-domain cookie (`Domain=.artifysols.com`, `Secure`, `HttpOnly`) or the two apps simply maintaining independent sessions against the same API — recommend the latter initially (simpler, no cookie-domain complexity) since the Control Center and Client Portal serve different user populations (internal staff vs. customers) in practice.

## 5. Environment configuration
- `Artify-Backend`: `DATABASE_URL`, `GEMINI_API_KEY`, `WEBHOOK_SIGNING_SECRET` (no insecure default — see `SECURITY_MODEL.md` S3/S4), `SESSION_TOKEN_TTL`, `CORS_ALLOWED_ORIGINS`.
- `artifysolscom`: `PLATFORM_API_BASE_URL` (new — does not exist today because the frontend never called an external backend by config), plus its own `GEMINI_API_KEY` only if the legacy consultant endpoint is kept as a thin proxy during transition (target: remove it entirely per §2.3).

## 6. Migration sequencing (see `MIGRATION_PLAN.md` and `IMPLEMENTATION_PLAN.md` for full detail)
Move the backend code and stand up real persistence (Phases 1-3) **before** rewiring either frontend (Phases 4+) — cutting the frontends over to a platform API that doesn't yet have a real database would just move the mocking problem, not fix it.
