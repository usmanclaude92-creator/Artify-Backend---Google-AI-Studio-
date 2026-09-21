# Observability (Phase 1)

## Structured logging
`server/core/logger.ts` (pino). Every log line carries `service`, `environment`, `level`, `timestamp`; request logs (`server/middleware/requestLogger.ts`, pino-http) additionally carry `requestId`, `route`, `method`, `statusCode`, `duration`, and — once a request is authenticated — `actorId`/`organizationId`.

**Redaction** (`server/core/logger.ts`'s `REDACT_PATHS`): `password`, `passwordHash`, `Authorization`/`Cookie` headers, any field named `token`/`sessionToken`/`apiKey`/`secret`/`webhookSecret`/`geminiApiKey`/`cardNumber`/`cvv` at any object depth pino's wildcard patterns reach, are replaced with `[REDACTED]` before a line is ever written. This directly fixes Phase 0 finding S8 (raw lead PII logged unredacted in the old `server.ts:177`).

## Request correlation
Every request gets an `X-Request-Id` (`server/middleware/requestId.ts`) — either accepted from a trusted upstream (validated against a safe charset/length to prevent header-injection) or generated. It's returned in the `X-Request-Id` response header, included in every log line for that request, and included in every API error response body (`server/core/apiResponse.ts`'s `meta.requestId` / `error.requestId`) — a client-reported error can be traced to exact server log lines by that ID alone.

## Health checks
Two distinct endpoints, per Phase 1's liveness/readiness split:
- `GET /api/v1/system/live` — process is up, no dependency check. Never fails unless the process itself is unresponsive.
- `GET /api/v1/system/ready` — performs a real, timeout-bounded `SELECT 1` against Postgres (`server/db/health.ts`) and returns `503` with `status: "not_ready"` if it fails. **This replaces the Phase 0 prototype's `/api/health`, which hardcoded `"database": "connected"` with no database in existence (finding S9).** Neither endpoint exposes the connection string, a raw driver error, or a stack trace — `checkDatabase()` catches and logs the real error server-side, returning only `{healthy: false}` to the caller.

## What's NOT yet implemented (honest gap, not hidden)
- **Error tracking** (Sentry or equivalent): not wired in. Errors are logged (pino, server-side) but not shipped to an external tracker. Tracked in `docs/PRODUCTION_READINESS_CHECKLIST.md`, targeted for Phase 15/16.
- **Metrics** (request rate, latency percentiles, error rate as time-series): not implemented. `pino-http`'s per-request `duration` field is the only latency signal today, visible in logs but not aggregated.
- **Alerting**: none configured — there's no staging/production deployment yet for it to monitor (Phase 16).
- **Background job monitoring**: not applicable yet — no background jobs exist (the `AiCoworker.schedule.cronExpression` field is modeled but nothing executes it; that's Phase 13).
