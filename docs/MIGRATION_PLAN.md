# Migration Strategy — Prototype → Production

Classification of every major piece of existing code, per the audit's REUSE / REFACTOR / REPLACE / REMOVE taxonomy. Cites `CURRENT_STATE.md` for evidence.

## REUSE (port largely as-is)
- `artifysolscom/server/core/apiResponse.ts` — response envelope + error codes. Solid, keep.
- `artifysolscom/server/services/authService.ts` — session issuance, `authenticateToken`/`requirePermission`/`requireRole`/`enforceTenantIsolation` middleware. Port into the platform; only the password-hashing call and the missing per-record ownership checks change (see `SECURITY_MODEL.md`, `AUTHORIZATION_MODEL.md`).
- `artifysolscom/server/types/index.ts` — domain type definitions (`Company`, `User`, `ProductServiceItem`, `Subscription`, `ArticleRecord`, `AiCoworker`, `AiTask`, permission/role enums). Becomes the basis for the Postgres schema and Prisma/Drizzle models.
- `artifysolscom/server/routes/v1/*` + `services/*` (auth, cms, product, subscription, lead, notification, ai) — route/service split is the right shape; swap the in-memory `db.ts` calls for real repository calls.
- `artifysolscom/server/ai/tools.ts`, `coworkerService.ts`, `provider.ts` — the AI tool-sandbox and human-approval pattern is a genuinely good design (see `PHASE_0_AUDIT_REPORT.md` §AI Findings); keep the shape, hardening only cost/usage tracking and the Gemini model-string consistency.
- `artify-backend`'s lead auto-triage scoring logic (`server.ts:347-411`) — business logic worth keeping, just needs to move behind the fixed webhook signature check and into `leadService`.
- Both repos' Vite/React/Tailwind frontend scaffolding, component structure, and the ~45+20 already-built marketing/admin UI components — the UI layer is not being rebuilt, only rewired to call real APIs instead of local mock state.
- `ErrorBoundary.tsx` (artifysolscom) — good practice, keep, and add the equivalent to `Artify-Backend`'s admin console (currently absent there).

## REFACTOR (keep the concept, change the implementation)
- `artifysolscom/server/core/db.ts` — same entity shapes, but becomes a set of repository classes backed by Postgres instead of `Map`s; password hashing moves to bcrypt/argon2.
- `AdminDataContext.tsx` (artify-backend) — keep as the admin console's client-side data layer *shape* (it already has sensible CRUD action names per module), but every action becomes a `fetch` to the platform API instead of a `useState` mutation; `localStorage` mirroring is removed once the API is the source of truth.
- `AuthContext.tsx` (artifysolscom) — keep the Context API shape and the hooks consumers already use (`useAuth()`), but `login`/`register`/`logout` become real API calls; remove the fabrication branches entirely.
- `artify-backend/server.ts` webhook route — keep the endpoint and the auto-triage call, fix the signature verification logic (reject on missing header) and stop hardcoding the secret client-side.
- Both `tsconfig.json`s — enable `strict: true` incrementally (not a one-shot flip across ~100 components; do it service-by-service as each is touched during the migration, tracked in Phase 15).

## REPLACE (prototype logic is not salvageable, rebuild against real infrastructure)
- All fabricated authentication (`AdminDataContext.tsx` login/`isAuthenticated` default, `AuthContext.tsx` login/register) — replaced wholesale by calls to the real `authService`-derived platform endpoints. Nothing here is reusable; it is by design a bypass.
- All fabricated billing/subscription/invoice/payment-method state in `AuthContext.tsx` — replaced by real subscription/invoice/payment records served from Postgres (payment processor integration itself is out of scope for the backend rebuild and should be its own ADR/ticket when a real payment provider is selected — none exists today).
- `artify-backend/src/data/seedData.ts` and `artifysolscom/src/data/portalData.ts`/`blogData.ts` as *runtime data sources* — replaced by real API responses. The files themselves are repurposed as **database seed scripts** (their shape is a fine starting fixture set) rather than deleted outright.
- The two duplicated legacy marketing Express entrypoints (`artifysolscom/server.ts`'s and `api/index.ts`'s bespoke `/api/ai-consultant` + `/api/brief-submit`) — replaced by a single call-through to the relocated `/api/v1/ai/consultant` and `/api/v1/leads`.
- Health/status endpoints that fabricate state (`artify-backend/server.ts:66`) — replaced by endpoints that perform a real DB ping and report actual connectivity.

## REMOVE (dead or dangerous, no migration path)
- `switchUserRole()` and any UI entry point to it (`artify-backend`) — a client-controlled privilege-escalation primitive; no production equivalent should exist.
- The webhook secret hardcoded in `AdminDataContext.tsx:607` and the insecure fallback in `server.ts:190` — rotate the value and remove both hardcodes; the secret must exist only as a server-side env var going forward.
- `localStorage`-persisted full user/session objects (`artify_auth_user_session`, `artify_super_admin_v2*`) as an authority — browser storage may still cache *display* data for offline-friendliness, but it stops being where authentication state is decided.
- Raw unredacted PII console logging (`server.ts:177`, `api/index.ts:151`).
- One of the two redundant animation libraries in `artifysolscom/package.json` (`framer-motion` vs `motion` — pick one, likely `motion` since it's the actively maintained successor).
- `bun.lock` in `artifysolscom` if the team standardizes on npm (matches the Dockerfile/CI reality) — or conversely, standardize the Dockerfile on Bun; pick one, stop carrying both signals.
- `nixpacks.toml` in `artifysolscom` once `railway.json`'s Dockerfile-based build is confirmed as the sole Railway build path (redundant alternate buildpack config).

## Sequencing constraint
REPLACE and REMOVE items that touch authentication (fabricated login, `switchUserRole`) must not ship removed until the REUSE/REFACTOR platform API (Phase 1-3) is live and both frontends are rewired (Phase 4+) — pulling the mock auth out first with no real backend yet would break both apps entirely. See `IMPLEMENTATION_PLAN.md` for exact phase ordering.
