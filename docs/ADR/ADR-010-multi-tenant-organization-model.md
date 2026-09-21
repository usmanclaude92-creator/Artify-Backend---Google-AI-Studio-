# ADR-010: Multi-Tenant Organization Model

## Status
Accepted (Phase 2)

## Context
Phase 1's `Company` model assumed one organization per user (`User.companyId`, a single required FK) — adequate for standing up authentication, but not the platform's real shape. The Phase 2 brief requires: an internal Artify organization and client organizations modeled uniformly, a user able to belong to multiple organizations eventually, and no assumption of "one user = one company" without justification.

## Decision
1. **Rename `companies` → `organizations`**, add `type` (`INTERNAL` | `CLIENT` | `PARTNER`), `legal_name`, `email`, `phone`, `website`, `address`, `country`, `timezone`, `currency`, `metadata` — Artify's own operating entity and every client organization are both rows in the same table, distinguished by `type`.
2. **Add `organization_memberships`** (`user_id`, `organization_id`, `role_id`, `status`, `is_primary`) as the real multi-org model, with a unique constraint on `(user_id, organization_id)` preventing duplicate membership rows.
3. **Keep `users.organization_id`** as the user's home/primary organization, for backward compatibility with the Phase 1 session model (a session is issued against one organization today). `organization_memberships.is_primary` marks which membership this pointer corresponds to.
4. **Identity scope: user email remains globally unique** (not per-organization) — this matches the Phase 0 real-backend design (`authService.ts`'s original global email scan) and is the more defensible choice for the current architecture: sessions and passwords are attached to a `User` row, not a `(User, Organization)` pair, so a globally unique identity avoids ambiguity about which account an email/password logs into.

## Consequences
- Every tenant-scoped table (leads, clients, contracts, subscriptions, invoices, CMS content, media, settings, ...) carries an explicit `organization_id` FK to this table — see `docs/DATABASE_SCHEMA.md` for the full list and `docs/AUTHORIZATION_MODEL.md` for how it's enforced.
- Every future Artify product (HCMS, Payroll, Accounting, CRM, ERP) is scoped by this same `organization_id`, not a product-specific tenant concept.

**Phase 3 update**: the "not fully realized yet" gap below is closed — see `ADR-016-session-scoped-authorization.md`. A session's role is now resolved from `organization_memberships` for that session's own organization, not from `users.role_id`; `POST /auth/switch-organization` lets a multi-org user act as a different organization within their existing login, re-verifying membership and rotating the session token. `users.organization_id` is kept as the home/default org pointer (unchanged rationale above), not retired.

## Alternatives considered
- Fully removing `users.organization_id` in favor of `organization_memberships` alone: rejected for Phase 2 — it would require reworking session issuance/verification (which organization does a session represent when a user has several memberships?), which is exactly the "authentication redesign beyond what is required to connect the schema" the brief prohibits. Revisit in Phase 3.
- Per-organization user identity (email unique only within an organization): rejected — see "Identity scope" above.
