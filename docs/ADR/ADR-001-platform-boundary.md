# ADR-001: Platform Boundary — Artify-Backend is the Platform of Record

## Status
Accepted (Phase 0)

## Context
Two repositories currently exist. `Artify-Backend` was intended as the future Control Center/Admin Platform but today has no real backend logic at all (no DB, no auth — `CURRENT_STATE.md` §1). `artifysolscom` was intended as the public site + portal, but it contains the only genuinely well-structured backend code in either repo (`server/` — real RBAC, session auth, tenant isolation — `CURRENT_STATE.md` §2.2/§2.4), almost entirely unused by its own frontend.

## Decision
`Artify-Backend` becomes the single authoritative Platform API and Control Center UI. `artifysolscom` becomes a pure consumer of that API for its public website and Client Portal, with no independent data store of its own. `artifysolscom/server/` is relocated into `Artify-Backend` (not duplicated) as the foundation of the platform API — see `MIGRATION_PLAN.md` and `INTEGRATION_ARCHITECTURE.md`.

## Consequences
- `Artify-Backend` gains real backend responsibility it doesn't have today; its current admin UI must be rewired to a real API instead of `seedData.ts` (Phase 4).
- `artifysolscom` loses its (unused) `server/` directory and its duplicated legacy marketing server logic, replaced by calls to the relocated platform (Phase 11).
- Future Artify products (HCMS, Payroll, Accounting, CRM, ERP) build against this same platform's identity/org/billing/audit primitives rather than standing up their own backends.

## Alternatives considered
- Keep `artifysolscom/server/` as the platform and have `Artify-Backend` consume it: rejected because it contradicts the brief's own framing of `Artify-Backend` as the Control Center/Admin Platform, and because `artifysolscom` is the more public-facing, higher-churn repo (marketing content changes far more often than platform logic should).
- Merge both repos into one monorepo: not rejected outright, but out of scope for Phase 0 — can be revisited after the API boundary is proven; a clean HTTP boundary between two repos is a prerequisite either way.
