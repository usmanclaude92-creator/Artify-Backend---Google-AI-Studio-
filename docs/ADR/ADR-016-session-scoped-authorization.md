# ADR-016: Session-Scoped Role Resolution via OrganizationMembership

## Status
Accepted (Phase 3)

## Context
`ADR-010` established `OrganizationMembership` as "the real multi-org model going forward" but Phase 2 still resolved a session's role from `User.roleId` — a single global role — and explicitly flagged this as a gap: "Phase 3 is expected to let a session switch between memberships and retire the `User.organizationId` pointer in favor of this table alone" (`prisma/schema.prisma`'s `OrganizationMembership` doc comment). Phase 3 needs organization switching (brief §18) and role assignment to work correctly for a user who holds different roles in different organizations — resolving from `User.roleId` alone cannot represent that.

## Decision
Every session's effective role/permissions are resolved from the `OrganizationMembership` row matching **that session's own `organizationId`**, not from `User.roleId`. `authService`'s internal `resolveSanitizedUserForOrganization(user, organizationId)` is the single choke point every login/session-verification/org-switch path goes through. `User.roleId`/`User.organizationId` are **not retired** — they remain the "home org" pointer set at registration and the default login target when no other organization is requested — but they are no longer the source of truth once a session exists.

A direct consequence, not just a naming change: `verifySession()` now re-checks live membership status on **every request**, not only at login. A membership suspended or removed after a session was issued invalidates that session on its very next use, with no separate revocation step required.

## Consequences
- **Positive**: organization switching (`POST /auth/switch-organization`) is correct by construction — permissions are recalculated from the target org's membership, never carried over from the session being replaced. Removing a user's access to an organization takes effect immediately, closing a gap that existed through Phase 2 (a revoked membership did not by itself invalidate an already-issued session).
- **Cost**: `verifySession` now does one additional indexed lookup (`organization_memberships` by `(user_id, organization_id)`, already unique-indexed — `ADR-010`) per authenticated request. Not currently pooled/cached; acceptable at Phase 3's scale, a candidate for a future short-TTL cache if profiling ever shows it matters.
- A user with no membership row for their own `User.organizationId` (should not occur given registration always creates one, `RESTRICT` FK) fails closed — `verifySession`/`login` return null/throw rather than falling back to `User.roleId`, so a data-integrity bug shows up as "access denied," never as a silent privilege mismatch.

## Alternatives considered
- Keep resolving from `User.roleId` and only add an `OrganizationMembership`-based check for the org-switch endpoint specifically: rejected — this would let a session opened before a membership change keep using a stale role for its "home" org indefinitely, since only the switch endpoint would re-verify. The chosen design makes every request self-correcting.
- Cache the resolved role on the session row at issuance, refreshed only on explicit switch: rejected — this is exactly the staleness problem above, just moved into a cache instead of `User.roleId`.
