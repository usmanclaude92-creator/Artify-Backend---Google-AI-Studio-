# CRM Architecture (Phase 5)

## Data model

```
Organization
  ├─ Lead ──(on convert)──> Client   (Lead.convertedClientId, Lead.convertedAt)
  │    └─ Contact (optional, contactName snapshot on the lead)
  └─ Client
       └─ Contact[]   (Contact.clientId, one isPrimary per client)
```

`Lead`, `Client`, and `Contact` are Phase 2 tables, extended (not replaced) in Phase 5 — see `docs/PHASE_5_IMPLEMENTATION.md` §1. All three carry `organizationId` and are always queried through it; none has a global (non-tenant-scoped) lookup method anywhere in the codebase.

## Lead

| Field | Notes |
|---|---|
| `companyName` | required |
| `contactName`, `email`, `phone`, `source`, `notes` | optional |
| `status` | `NEW \| CONTACTED \| QUALIFIED \| CONVERTED \| LOST` |
| `assignedTo` | optional user id |
| `convertedClientId`, `convertedAt` | set only by `POST /leads/:id/convert`, never by `PATCH` |

**Status lifecycle**: `NEW`/`CONTACTED`/`QUALIFIED`/`LOST` are non-terminal and freely inter-transition, including `LOST` → any of the other three (reopening). `CONVERTED` is terminal and reachable only through the dedicated conversion endpoint; a `PATCH` that tries to set `status: "CONVERTED"` directly is rejected (400), and any further mutation of an already-converted lead is rejected (409).

## Client

| Field | Notes |
|---|---|
| `clientCode` | required, `@@unique([organizationId, clientCode])` — the only DB-level uniqueness |
| `name` | required display name |
| `legalName`, `email`, `phone`, `website`, `address`, `notes`, `accountManager` | optional |
| `status` | `PROSPECT \| ACTIVE \| INACTIVE \| SUSPENDED \| ARCHIVED` |

Business-name duplicates are detected in the **service layer** (case-insensitive, organization-scoped) rather than a DB constraint, so two organizations — or, deliberately, even the same organization — may share a display name; only `clientCode` is a hard uniqueness guarantee. Client deletion is a soft delete (`deletedAt`), never physical: `Contract`/`Subscription`/`Invoice` (Phase 2 tables, not yet built out) hold `RESTRICT` foreign keys to `Client`, so archiving preserves historical/commercial relationships instead of risking either an FK violation or silent data loss once those modules exist.

## Contact

| Field | Notes |
|---|---|
| `firstName`, `lastName` | required |
| `email`, `phone`, `jobTitle` | optional |
| `isPrimary` | boolean, enforced at most one `true` per client |
| `clientId` | the client this contact belongs to |

**Primary-contact enforcement is defense-in-depth, at two layers**: a hand-written partial unique index (`contacts_one_primary_per_client`, `WHERE is_primary = true AND client_id IS NOT NULL AND deleted_at IS NULL`) is the DB-level guarantee Prisma's schema DSL can't express natively; `contactService` additionally clears the previous primary inside the same `prisma.$transaction` as the new create/update, so the application never relies on the constraint alone to produce correct behavior (a naive "just let the DB reject it" approach would surface as a confusing 500 to the second write instead of a clean primary-swap).

## Multi-tenancy

Every CRM request follows: **authenticated user → org membership (from the session) → permission check → tenant-scoped repository query → record**. No repository exposes a bare `findById`; the only lookup method is `findByIdInOrg(id, organizationId)`. A request for a lead/client/contact id belonging to another organization returns **404**, never 403 — consistent with the Phase 4 convention of not confirming a record's existence to a caller who isn't authorized to see it. `tests/integration/leads.test.ts`, `clients.test.ts`, and `contacts.test.ts` each include an explicit IDOR test: an authenticated user from Organization B given Organization A's real record id gets 404 on read/update/delete.

## Permissions

`leads.read/create/update/delete/convert`, `clients.read/create/update/delete`, `contacts.read/create/update/delete` — all centralized in `PERMISSION_KEYS` (`server/types/domain.ts`) and enforced by the existing `requirePermission` middleware; no CRM route hard-codes a role check. Frontend visibility (`src/lib/permissions.ts` `NAV_ITEMS`) mirrors these keys but is UX only — every mutation still requires the backend to independently accept the caller's permission, proven by the IDOR/tenant-isolation tests above plus the existing `tests/security/authBypass.test.ts`.

## Lead→Client conversion (transaction)

`POST /leads/:id/convert` (permission: `leads.convert`) runs entirely inside one `prisma.$transaction`:

1. Load the lead (`findByIdInOrg` — 404 if it's not in the caller's org).
2. If already `CONVERTED`, return 409 with `convertedClientId` in the response body (safe, idempotent-looking conflict, not a silent no-op).
3. Check the requested `clientCode` isn't already taken in this org (409 if so).
4. **Inside the transaction**: create the `Client`; optionally create a primary `Contact` from the lead's `contactName`; mark the lead `CONVERTED` via a conditional `updateMany` (`WHERE id = ? AND organizationId = ? AND status != 'CONVERTED'`) and check the affected-row count is exactly 1 — if not (a concurrent conversion won the race), throw, which rolls back everything created in this transaction, including the client and contact rows.
5. After commit: write `CLIENT_CREATED` then `LEAD_CONVERTED` to the append-only audit log, with the client/lead ids as resource identifiers — no PII/credentials in the metadata.

This design means a duplicate/repeated/concurrent conversion attempt can never produce a second client or a half-converted lead; `tests/integration/leadConversion.test.ts` proves the race directly (two concurrent conversion calls, exactly one client created, the loser sees 409).

## Audit logging

Reuses the existing Phase 2/3 append-only `auditLogRepository.record()` unchanged — no second audit mechanism. New action values: `LEAD_CREATED`, `LEAD_UPDATED`, `LEAD_DELETED`, `LEAD_CONVERTED`, `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_ARCHIVED`, `CONTACT_CREATED`, `CONTACT_UPDATED`, `CONTACT_DELETED`.

## Known limitations

- No product catalog, billing, contracts, or subscription data is wired to clients yet (Phase 2 has the tables; Phase 5 does not build on them) — a client's detail view shows only CRM fields, deliberately not a "Billing" tab with nothing behind it.
- The frontend router has no URL-parameter support (`src/lib/router.tsx`), so Lead/Client detail views are in-page master-detail/modal state, not deep-linkable `/clients/:id` routes.
- Assigning a lead to a specific user (`assignedTo`) is stored and filterable but has no notification/reminder system behind it (explicitly out of Phase 5 scope).
