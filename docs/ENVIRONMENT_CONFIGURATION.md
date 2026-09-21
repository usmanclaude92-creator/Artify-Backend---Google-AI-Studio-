# Environment Configuration

All configuration is validated once, at startup, by `server/config/env.ts` (zod schema). Nothing else in the codebase should read `process.env` directly — import `config` from `server/config/env` instead. Missing or invalid required configuration makes the process exit(1) immediately with a list of what's wrong; it never silently substitutes a default secret (that exact pattern was Phase 0 finding S3/S4).

## Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `staging` \| `production`. `staging`/`production` trigger stricter validation (see below). |
| `PORT` | No | `3000` | |
| `DATABASE_URL` | **Yes** | — | Must be a `postgresql://` or `postgres://` connection string. |
| `SESSION_SECRET` | **Yes** | — | Min 16 chars in dev, **min 32 chars in staging/production** (enforced). |
| `COOKIE_DOMAIN` | No | — | Reserved for a future cookie-based session (Phase 3); unused by the current bearer-token flow. |
| `CORS_ORIGINS` | **Yes** | — | Comma-separated allow-list. **`*` is rejected in staging/production.** |
| `LOG_LEVEL` | No | `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`. |
| `WEBHOOK_SECRET` | **Yes** | — | Min 16 chars. **Rejected outright if it equals the Phase 0 compromised value** (`artify_whsec_prod_2026_soc2`) — renamed from `ARTIFY_WEBHOOK_SECRET`, see below. |
| `AI_PROVIDER` | No | `gemini` | `gemini` \| `none`. |
| `GEMINI_API_KEY` | No | `""` | Empty is allowed — AI endpoints report unavailable rather than failing to boot. Server-side only, never sent to a frontend. |
| `OBJECT_STORAGE_PROVIDER` | No | `none` | `none`\|`s3`\|`r2`\|`supabase` — Phase 9 not implemented yet, `none` is the only meaningfully valid value today. |
| `OBJECT_STORAGE_BUCKET` | No | `""` | |

## The `ARTIFY_WEBHOOK_SECRET` → `WEBHOOK_SECRET` rename

This is deliberate, not an oversight. The old variable's default fallback value, hardcoded in the Phase 0 prototype's `server.ts`, is compromised — it was shipped both server-side (as a fallback) and client-side (in `AdminDataContext.tsx`'s bundle). Renaming the variable means an environment that forgets to set the new secret **fails to boot** (zod requires it, no fallback exists) instead of silently continuing to accept the old, public value. If you're migrating a deployment: generate a fresh value and set `WEBHOOK_SECRET`; do not copy the old `ARTIFY_WEBHOOK_SECRET` value over.

Generate any of the secret values with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Local development
Copy `.env.example` to `.env` and fill in real values. `.env` (and `.env.test`, `.env.production`, etc.) are gitignored — never commit one. See `docs/DEVELOPMENT_SETUP.md`.

## Test environment
`.env.test` is loaded by `tests/setup.ts` before any test file imports `server/config/env.ts` (dotenv does not overwrite already-set variables, so this ordering matters — see that file's comment). It must point at a database/schema distinctly marked as test data; `tests/helpers/db.ts`'s `resetDb()` refuses to run otherwise. See `docs/DATABASE_SETUP.md`.

## CI
GitHub Actions (`.github/workflows/ci.yml`) sets all required variables inline as job-level `env:` — CI-only placeholder values, never real secrets, against a Postgres service container spun up for the job. See `docs/CI_CD.md`.
