# ADR-015: Row Level Security vs. Backend Authorization Boundary

## Status
Accepted (Phase 2)

## Context
Supabase Postgres ships with Row Level Security (RLS) available and often enabled by default for tables managed through the Supabase dashboard/client SDK, because Supabase's common usage pattern lets browsers query Postgres (via PostgREST) directly, with RLS as the *only* authorization boundary. This project's architecture is different: `docs/TARGET_ARCHITECTURE.md` fixes the boundary as `Browser → Artify Platform API → Prisma → Postgres` — the browser never holds Postgres credentials or queries the database directly (`docs/AUTHORIZATION_MODEL.md`, `docs/SECURITY_MODEL.md`). The Phase 2 brief asks this to be explicitly evaluated and decided, not assumed.

## Decision
**RLS is not enabled on application tables.** Authorization is enforced entirely in the Artify Platform API layer: `server/middleware/auth.ts`'s `requirePermission`/`requireRole`/`enforceTenantIsolation`/`enforceRecordOwnership`, backed by the `role_permissions` schema (`ADR-011`) and `organization_id` tenant scoping (`ADR-010`) enforced in repository queries. The database connection Prisma uses is a single application-level role with full read/write on application tables — the same trust model as any traditional Postgres-backed API service, not a per-end-user RLS-scoped connection.

This is deliberate, not an oversight: enabling RLS without a coherent policy set would either (a) do nothing useful, since the Prisma connection is a single trusted application role that RLS policies would need to exempt anyway (defeating RLS's purpose), or (b) actively conflict with the backend's own authorization decisions if policies were written against a different identity model than `role_permissions`, creating two authorization systems that could disagree.

## Consequences
- **Defense-in-depth is achieved through the backend's own layering** (route → validation → authorization middleware → service → repository, each repository call scoped by `organization_id` — `ADR-010`, `docs/AUTHORIZATION_MODEL.md`), tested directly (`tests/security/authz.test.ts`, `tests/security/rbacAndAudit.test.ts`'s tenant-isolation query test) — not through a second, independent RLS layer.
- If a future requirement genuinely needs defense-in-depth at the database layer itself (e.g. a compliance requirement that a compromised application role alone cannot read cross-tenant data), that would be a deliberate, separately-designed addition — a distinct low-privilege Postgres role per deployment tier, or genuine RLS policies mirroring the `role_permissions`/`organization_id` model exactly — not "turn RLS on" as a checkbox. Not needed or built in Phase 2.
- Supabase Auth, Supabase Storage, and Supabase's auto-generated PostgREST/GraphQL APIs are **not used** by this project — only the underlying Postgres database (`ADR-008`, `ADR-009`). There is exactly one identity system (`ADR-010`/`ADR-011`'s `users`/`roles`/`permissions`), never a second one introduced by adopting a Supabase feature incidentally.

## Alternatives considered
- Enabling RLS with policies mirroring `organization_id`/`role_permissions`: considered and deferred, not rejected outright — it's a legitimate future defense-in-depth addition (see Consequences), but writing and testing a full RLS policy set for ~30 tables is significant, separately-scoped work the Phase 2 brief's "do not overbuild" instruction argues against doing speculatively now, especially since the backend-only boundary is not weaker for it in the current architecture (no untrusted client ever reaches Postgres directly).
- Enabling RLS "just in case," with permissive (`USING (true)`) policies: rejected — this provides zero actual protection while creating a false impression of a security layer, which is worse than no RLS at all if it's ever relied upon.
