# Client Portal Architecture (Phase 10 §25/§26)

## The boundary

The Client Portal is a read-only view over the canonical Artify Platform API — never a direct PostgreSQL/Supabase connection, never a service-role key, never a second billing database, never duplicated commercial logic:

```
Client Portal UI (ClientPortalPage.tsx)
        │  Bearer session token, same auth as the Control Center
        ▼
Artify Platform API (/api/v1/portal/*)
        │
        ▼
clientPortalService  ──►  contractRepository / subscriptionRepository / invoiceRepository / paymentRepository
        │
        ▼
     Prisma  ──►  PostgreSQL
```

No new tables, no new auth system, no fabricated data anywhere — every figure the portal shows is a real row read through the same repositories the Control Center uses.

## The non-obvious part: whose organizationId?

`Contract`/`Subscription`/`Invoice`/`Payment.organizationId` is always the **agency's own** internal organization — the same organization that owns the `Client` CRM record via `Client.organizationId`. It is **not** the client's own provisioned workspace organization (`Client.workspaceOrganizationId`, set by Phase 6's `POST /clients/:id/workspace/provision`). A naive `WHERE organizationId = session.organizationId` filter would therefore be wrong the moment a client user's session is scoped to their own workspace org — it would either match nothing, or (worse, if the agency's org id and a workspace's org id ever coincided) leak the wrong tenant's data.

`clientRepository.findByWorkspaceOrganizationId(workspaceOrganizationId)` is the resolution step: given the caller's **current session's** `organizationId`, find the one `Client` row whose `workspaceOrganizationId` matches it. `clientPortalService`'s every method starts by calling this (`resolveClientForCaller`), then scopes every subsequent query by that `Client`'s `id` **and** its owning agency `organizationId` (`client.organizationId`) — never by a client-supplied id, and never by the session's own `organizationId` directly.

```
session.organizationId (the workspace org the caller has switched into)
        │
        ▼  clientRepository.findByWorkspaceOrganizationId
Client row  (client.id, client.organizationId = the agency's org)
        │
        ▼  contractRepository.list(client.organizationId, { clientId: client.id }, ...)
Only this client's contracts/subscriptions/invoices/payments
```

## How a user gets a portal view

No new authentication system was introduced. A user sees a portal view by holding an `ACTIVE` `OrganizationMembership` in a client's workspace organization (exactly the membership the existing invitation/onboarding flow — Phase 6 — already grants) and switching their active session into it via the existing Phase 3 `POST /auth/switch-organization`. From that point their session's `organizationId` **is** that workspace org, and `clientPortalService` resolves it as above.

An agency staffer browsing their own internal organization has no `Client` row whose `workspaceOrganizationId` matches their own org id — `resolveClientForCaller` throws `AuthorizationError` (403) uniformly, with no observable difference between "you're not a client user" and any other resolution failure, so the failure mode itself leaks nothing.

## Permissions

`portal.dashboard.read`, `portal.contracts.read`, `portal.subscriptions.read`, `portal.invoices.read`, `portal.payments.read` — deliberately separate from the internal `contracts.*`/`invoices.*`/`payments.*` keys, and granted to **every** internal role (ADMIN/MANAGER/USER/VIEWER), not tiered by role. This is intentional: the real access-control boundary here is the `Client`-resolution step above, not the permission tier — any authenticated user who has switched into a client's workspace organization should see that workspace's own portal view, regardless of which internal role they happen to hold in it. A genuine external client contact is invited with a `VIEWER`-tier membership in their own workspace (no `contracts.create`/`invoices.issue`/`payments.reverse` etc.), so they structurally cannot reach any mutation endpoint even though `portal.*` is granted broadly — verified directly in `tests/integration/clientPortal.test.ts`.

## What the portal can never do

Every portal route (`server/routes/v1/portalRoutes.ts`) is `GET`-only. There is no portal-specific create/update/issue/void/reverse endpoint, and the frontend's `ClientPortalPage.tsx` renders no button that would call one — a client user cannot modify invoice totals, payment status, subscription pricing, or contract values, publish CMS content, manage internal users, assign roles, or access platform administration, because none of those code paths are reachable from a workspace-org session in the first place (the internal mutation endpoints are permission-gated as normal, and a `VIEWER`-tier client membership holds none of those permissions).

## Isolation

Cross-organization isolation is structural, not merely tested: `clientPortalService` can only ever resolve to the **one** `Client` row matching the caller's own session organization, so there is no code path by which a request scoped to client A's workspace session could return client B's rows — not through an id parameter (every detail route re-checks `record.clientId === client.id`, returning 404 rather than 403 to avoid confirming the record's existence to the wrong tenant), and not through the list endpoints (which never accept a caller-supplied `clientId` filter at all). `tests/integration/clientPortal.test.ts` verifies this directly with two fully independent clients/workspaces/invoices.
