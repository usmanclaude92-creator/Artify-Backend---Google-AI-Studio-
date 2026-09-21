# Client Onboarding Architecture (Phase 6)

## Relationship to workspace provisioning

Onboarding and workspace provisioning are two independent but related processes, both anchored to a CRM `Client`:

```
CRM Client
    ├── ClientOnboarding (0 or 1) — process/checklist state
    └── workspaceOrganizationId (0 or 1) — the provisioned operational tenant
```

See `docs/WORKSPACE_PROVISIONING.md` for the workspace side. This document covers the onboarding record and checklist.

## Onboarding status

```
NOT_STARTED → IN_PROGRESS → READY → COMPLETED
                    ↓
                CANCELLED
```

- **NOT_STARTED**: implicit — no `ClientOnboarding` row exists yet for the client.
- **IN_PROGRESS**: a row exists; at least one checklist item is incomplete.
- **READY**: every checklist item is complete, but `POST /onboarding/:id/complete` hasn't been called yet — a deliberate explicit final step (§7: completion is never inferred from "all steps done").
- **COMPLETED**: terminal. `completedAt`/`completedById` set.
- **CANCELLED**: terminal, reachable from `NOT_STARTED`/`IN_PROGRESS`/`READY` via `PATCH /onboarding/:id { status: "CANCELLED" }`.

Once `COMPLETED` or `CANCELLED`, no further step completion or status change is accepted (409).

**Independent of workspace status** — this is the load-bearing design decision from the brief (§7): `ClientOnboarding` has no foreign key to `Organization.status` and no service method touches both in the same write. A workspace can be `ACTIVE` while onboarding is still `IN_PROGRESS` (an admin activated it manually before finishing setup), or `TRIAL` while onboarding shows `READY` (everything checked off, formal completion pending). Both are legitimate, independently observable states.

## Checklist

Seven fixed stages (§8), stored as a JSON array on `ClientOnboarding.checklist` rather than a child table:

| Key | Label |
|---|---|
| `CLIENT_VERIFIED` | Client verified |
| `WORKSPACE_CREATED` | Workspace created |
| `PRIMARY_CONTACT_CONFIRMED` | Primary contact confirmed |
| `ADMINISTRATOR_INVITED` | Administrator invited |
| `ADMINISTRATOR_ACCEPTED` | Administrator accepted |
| `WORKSPACE_CONFIGURED` | Workspace configured |
| `ONBOARDING_COMPLETED` | Onboarding completed |

Each item carries `{key, label, completed, completedAt, completedById}`. JSON over a separate table because: (a) it's always read and written as a whole with its parent record, never queried independently across onboarding records; (b) it's genuinely extensible — a future stage is a code change to the fixed key list plus (if needed) a one-time backfill, not a schema migration; (c) it avoids an unnecessary join for the common case (rendering one client's onboarding detail).

`currentStep` on the record mirrors the first incomplete item's key, kept in sync on every write — a denormalized read optimization for list views (`GET /onboarding`), not a second source of truth for completion state (the checklist array is authoritative; `currentStep` is always recomputed from it, never set independently).

### Automatic step completion

Some steps are marked complete as a side effect of other Phase 6 operations, not only via the manual `PATCH /onboarding/:id { completeStep }`:

- `WORKSPACE_CREATED` — set by `workspaceService.provisionWorkspace()` after a successful provision.
- `ADMINISTRATOR_INVITED` — set by `invitationService.createInvitation()` after a successful invite.
- `ADMINISTRATOR_ACCEPTED` — set by `invitationService.acceptInvitation()` after a successful acceptance.

`CLIENT_VERIFIED`, `PRIMARY_CONTACT_CONFIRMED`, and `WORKSPACE_CONFIGURED` are manual-only — they represent a human judgment call (is the contact actually right? is configuration actually done?) that no automated action can honestly claim on the operator's behalf. Step completion is idempotent throughout: re-completing an already-complete step, from either path, is a no-op, not an error — necessary because both the manual and automatic paths can legitimately race or repeat.

## Onboarding record

```
ClientOnboarding
  id, organizationId (owning CRM tenant), clientId (unique — 1:1)
  status, currentStep, checklist (json)
  startedAt, completedAt, cancelledAt
  createdById, completedById
  createdAt, updatedAt
```

`organizationId` matches `Client.organizationId` — the CRM-owning tenant, not the workspace — so onboarding records are tenant-scoped and listed the same way leads/clients/contacts are (`findByIdInOrg`-style lookups only, no bare `findById`).

## Audit trail

Reuses the existing append-only `auditLogRepository.record()` — no second audit mechanism. Actions: `CLIENT_ONBOARDING_STARTED`, `ONBOARDING_STEP_COMPLETED` (one row per step, including automatic completions — every completion in this flow carries the acting user, since even the automatic ones are triggered by an authenticated caller's provision/invite/accept action, never a background job), `CLIENT_ONBOARDING_COMPLETED`, `CLIENT_ONBOARDING_CANCELLED`.

## API

```
GET    /api/v1/onboarding                       list, tenant-scoped, filter by status/search
GET    /api/v1/onboarding/:id                    detail
PATCH  /api/v1/onboarding/:id                     { completeStep } or { status: "CANCELLED" }
POST   /api/v1/onboarding/:id/complete            READY -> COMPLETED
POST   /api/v1/clients/:clientId/onboarding/start  create the record (409 if one already exists)
GET    /api/v1/clients/:clientId/onboarding        the one onboarding record for a client, if any
```

Every endpoint: `authenticateToken` + `requirePermission` (`onboarding.read/create/update/complete`) + tenant scope re-derived from the caller's session, never a request-supplied `organizationId`.

## Known limitations

- The checklist's fixed 7-key set is a code-level constant (`server/schemas/onboardingSchemas.ts`), not a database-configurable list — adding an 8th stage is a code change, not an admin-UI action. Acceptable for Phase 6; a future phase could move it to a `SystemSetting`-backed list if per-tenant customization becomes a real requirement.
- No reminder/notification system nudges an onboarding stuck `IN_PROGRESS` — the queue (`GET /onboarding`, Control Center's Onboarding Overview/Pending Onboarding pages) is the only visibility mechanism today.
