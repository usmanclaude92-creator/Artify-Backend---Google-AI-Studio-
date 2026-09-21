# Phase 5 — CRM & Client Management

Implementation notes, scoped to the brief: Lead/Client/Contact management, Lead→Client conversion, CRM dashboard, and Control Center CRM UI, built entirely on the Phase 1-4 foundation (Prisma, auth, sessions, organizations, memberships, RBAC, permissions, tenant isolation, audit logging, `/api/v1`, Control Center shell, frontend API architecture). No product catalog, subscriptions, billing, invoices, contracts, CMS, media, AI, marketing automation, or external CRM integrations. See `docs/CRM_ARCHITECTURE.md` for the architecture and `docs/PHASE_5_COMPLETION_REPORT.md` for status.

## What changed, and why

### 1. Inspection findings (Phase 2 already had the tables)
`Lead`, `Client`, and `Contact` models already existed from Phase 2 (`docs/DATABASE_SCHEMA.md`). Phase 5 did **not** create parallel tables. It extended the existing three:
- `Lead` gained `convertedClientId`/`convertedAt` (conversion audit trail — a lead needs to remember which client it became).
- `Client` gained `name` (required — Phase 2's `Client` had no display-identity field at all, only `clientCode`), `legalName`, `email`, `phone`, `website`, `address`. `ClientStatus` was extended from `{ACTIVE, INACTIVE, CHURNED}` to `{PROSPECT, ACTIVE, INACTIVE, SUSPENDED, ARCHIVED}` per the brief's lifecycle (§11); `CHURNED` had no data using it and was not a state the brief's status list uses.
- `Contact` gained `isPrimary` (the brief's "primary contact indicator," §13).

No new CRM tables were introduced. The `RESTRICT` foreign keys from `Contract`/`Subscription`/`Invoice` to `Client` (Phase 2) are the reason Client/Lead deletion is soft (`deletedAt`), not physical — destroying a client row would either violate those constraints or silently orphan historical billing/contract data once those modules exist.

### 2. Database migration (`prisma/migrations/20260922000001_phase5_crm/`)
Additive, hand-verified safe against a populated table: `Client.name` was added nullable first, backfilled from `clientCode` for any pre-existing row, then set `NOT NULL` — never a bare `ADD COLUMN ... NOT NULL` with no default. `contacts_one_primary_per_client` is a hand-written partial unique index (`WHERE is_primary = true AND client_id IS NOT NULL AND deleted_at IS NULL`) — Prisma's schema DSL cannot express a filtered unique constraint, so it was added directly to the migration SQL, the same technique Phase 2 used for its `CHECK` constraints. Verified as both an upgrade path (`artify_dev`, `artify_test`) and from a from-scratch database (`artify_fromzero`, all 4 migrations applied in order).

### 3. Backend additions (all additive, tenant-scoped, permission-gated)
Repositories: `leadRepository`, `clientRepository`, `contactRepository` — each exposes exactly one id-lookup method (`findByIdInOrg`), never a bare `findById`, so cross-tenant access is structurally impossible at the data layer, not just checked in the service. Services: `leadService`, `clientService`, `contactService` — validation, duplicate detection, status-transition rules, and audit writes. Routes (mounted under `/api/v1`): `leadRoutes` (`/leads`), `clientRoutes` (`/clients`, with nested `/clients/:clientId/contacts`), `contactRoutes` (`/contacts`, standalone by-id plus an org-wide directory `GET /contacts`), `crmRoutes` (`/crm/summary`). New permission keys: `leads.convert`, `contacts.read/create/update/delete` (`leads.read/create/update/delete` and `clients.*` already existed).

### 4. Lead status lifecycle
`NEW`/`CONTACTED`/`QUALIFIED`/`LOST` freely inter-transition server-side; `LOST` can reopen to any non-terminal status. `CONVERTED` is reachable **only** via `POST /leads/:id/convert`, never a generic `PATCH status=CONVERTED` (rejected with a 400 naming the correct endpoint) — and once converted, a lead is terminal: further edits return a 409.

### 5. Lead→Client conversion (transactional)
`leadService.convertLead()` runs inside a single `prisma.$transaction`: creates the `Client`, optionally creates a primary `Contact` from the lead's `contactName`, then marks the lead `CONVERTED` via a **conditional** `updateMany` (`WHERE status != 'CONVERTED'`) and checks the affected-row count. A concurrent duplicate conversion attempt affects 0 rows, which throws and rolls back the entire transaction — including the client/contact rows just created inside it — so two simultaneous conversions of the same lead can never produce two clients. Verified directly by `tests/integration/leadConversion.test.ts`'s race test. `CLIENT_CREATED` and `LEAD_CONVERTED` are both written to the append-only audit log after the transaction commits.

### 6. Duplicate detection — service-level, not a DB constraint
Client/lead business names are checked for duplicates in the service layer (case-insensitive, organization-scoped), deliberately **not** a database unique constraint — the brief (§19) explicitly requires that two organizations (or even the same organization) may legitimately share a display name; only `clientCode` is DB-unique (`@@unique([organizationId, clientCode])`, pre-existing). Lead/contact email duplicate checks are similarly service-level and organization-scoped.

### 7. Frontend
`src/lib/api.ts` gained a CRM section: `Lead`/`CrmClient`/`CrmContact`/`CrmSummary` types and `leadsApi`/`clientsApi`/`contactsApi`/`crmApi` — built entirely on the existing `apiClient`/`paginatedGet()` helpers, no parallel fetch layer. `src/lib/permissions.ts`'s `NAV_ITEMS` gained a `section: "Platform" | "CRM"` grouping field and four CRM entries (Dashboard, Leads, Clients, Contacts), each gated by the matching `*.read` permission (Dashboard is unrestricted, matching the existing Platform Dashboard's pattern). `Sidebar.tsx` now renders nav items grouped under a section heading. Four new pages: `CrmDashboardPage` (real counts from `/crm/summary`, degrades per-permission — never fabricates a metric it can't compute), `LeadsPage` (search/status filter/pagination/create/edit/convert/delete), `ClientsPage` (master-detail list following the `OrganizationsPage` precedent, with embedded contact management — add/mark-primary/remove — since the router has no URL-parameter support), `ContactsPage` (org-wide directory with a client filter, per the brief's own nav structure listing Contacts as a peer of Leads/Clients).

### 8. Why an org-wide `GET /api/v1/contacts` endpoint was added
The brief's own §22 nav example lists Contacts as a top-level item, not only reachable via a client's detail page. The originally-scoped nested routes (`/clients/:clientId/contacts`) can't back a real directory view, so `contactRepository.listForOrg()` / `GET /contacts` (tenant-scoped, optional `clientId` filter validated against the caller's org) was added — required by the brief's own UI structure, not speculative.

### 9. Deliberate Phase 5 scope boundaries
No product catalog, subscriptions, billing, invoices, contracts, CMS, media, AI automation, sales-pipeline automation, marketing automation, external CRM integrations, accounting, payroll, or ERP work was built or wired. `artifysolscom` was not touched — Phase 5 CRM is Control Center/admin-facing only; the client-facing app has no CRM surface to expose.
