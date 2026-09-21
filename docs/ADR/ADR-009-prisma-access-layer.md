# ADR-009: Prisma as the Sole Database Access Layer

## Status
Accepted (Phase 0, resolved in Phase 1 per `ADR-002-database.md`'s "Phase 1 resolution" note); restated here as its own ADR per the Phase 2 brief's explicit numbering request.

## Context
`ADR-002-database.md` deferred an ORM choice between Prisma and Drizzle; Phase 1 resolved it to Prisma. Phase 2 explicitly asks: "Do not introduce a second ORM. Do not introduce Supabase client libraries merely to duplicate Prisma functionality."

## Decision
Prisma is the **only** database access layer in this codebase. No route, service, or repository ever imports `@supabase/supabase-js` or issues raw SQL outside of the narrow, reviewed exceptions already in the codebase (`server/db/health.ts`'s `SELECT 1` liveness probe, and `server/routes/v1/systemRoutes.ts`'s `_prisma_migrations` introspection query for the `/system/database` endpoint — both read-only, both safe, both documented inline).

## Consequences
- Every table lives in `prisma/schema.prisma`; every migration is Prisma-generated and reviewed (`docs/DATABASE_SETUP.md`).
- The repository layer (`server/repositories/*`) is the only code that imports the Prisma client directly — services and routes never do (Phase 1 §27 layering, unchanged).
- Supabase-specific features (Row Level Security, Auth, Storage, Realtime) are either not used (Auth — see `ADR-015`) or would, if adopted later, need their own explicit ADR and would not replace Prisma as the query layer.

## Alternatives considered
- Supabase's auto-generated PostgREST API as a second access path (e.g. for the frontend to query directly): rejected outright — this would violate the Browser → API → Prisma → Postgres boundary the brief requires and reintroduce exactly the kind of untrusted-client-write risk `docs/SECURITY_MODEL.md` was written to close.
