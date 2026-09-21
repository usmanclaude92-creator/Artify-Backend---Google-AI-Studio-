# Workspace Provisioning (Phase 6)

## CRM Client → Workspace relationship

```
Artify Platform
       │
       ├── Platform administration (Artify HQ's own Organization, type=INTERNAL)
       │
       └── Client Organization / Workspace (a normal Organization row, type=CLIENT)
                │
                ├── Users
                ├── OrganizationMembership (roles)
                └── Sessions
```

A **workspace is not a new model.** It is the existing `Organization` (Phase 2) — the same table that already backs every platform tenant, with its own memberships, roles, and sessions. Phase 6 does not introduce `client_organizations`, `workspaces`, or `tenant_organizations` as separate tables (§4's explicit prohibition); it links an existing `Organization` row to a `Client` instead.

```
Client (CRM record)                  Organization (operational tenant)
  organizationId  ──owns (CRM)──►    (the org that manages this client's CRM data,
                                       effectively always Artify HQ)
  workspaceOrganizationId ──1:1──►   (the provisioned workspace itself, nullable
                                       until provisioning; @unique on both sides)
```

`Client.organizationId` and `Client.workspaceOrganizationId` point at **different organizations** for a real client: the former is who manages the CRM record (the platform operator), the latter is the client's own operational tenant. This is the concrete fix for the brief's explicit warning against conflating them (§2: "do not assume CRM Client = User," and by extension, do not assume CRM Client = Workspace = the same tenant as its own CRM owner).

**A CRM Client is the commercial record. A Workspace is the operational tenant.** They are related 1:1, explicitly, auditably — never implicitly inferred from a shared organization id.

## Uniqueness (§5)

`Client.workspaceOrganizationId` is `@unique` at the database level — a second client can never point at the same workspace, and (combined with the provisioning transaction below) a client can never end up with two workspaces. The schema is extensible for a future many-workspaces-per-client model (drop the column's uniqueness, add a join table) without redesigning the Client or Organization models, but that complexity is not built now — YAGNI per §5's own instruction.

## Workspace status

Reuses `OrganizationStatus` (Phase 2) rather than a new enum, per §6's "use an existing enum if already present":

| OrganizationStatus | Conceptual meaning |
|---|---|
| `TRIAL` | PENDING — just provisioned, not yet activated |
| `ACTIVE` | ACTIVE |
| `SUSPENDED` | SUSPENDED |
| `ARCHIVED` | DEACTIVATED (terminal) |

Transitions are validated server-side (`workspaceService.assertValidWorkspaceTransition`): `TRIAL → ACTIVE | ARCHIVED`, `ACTIVE → SUSPENDED | ARCHIVED`, `SUSPENDED → ACTIVE | ARCHIVED`, `ARCHIVED →` (nothing — terminal). An invalid transition is a 409, not a silent no-op or a 500.

Setting `status` to `SUSPENDED` or `ARCHIVED` additionally requires the `workspaces.suspend` permission, checked inside the service even though the route itself only requires `workspaces.update` — the same conditional-permission pattern `organizationService.updateMember` uses for `roles.assign` (Phase 3).

## Configuration

Foundational fields only (§16): `name`, `timezone` (default `"UTC"`), `currency` (default `"USD"`, never hardcoded to OMR — §17; an operator can pass any ISO 4217 code at provisioning time, e.g. `"OMR"` for an Oman-based client), `locale` (default `"en"`), `email`/`phone`/`website`/`address`. No product-specific settings system — that's explicitly out of scope.

## Provisioning transaction (§13)

```
Validate client (findByIdInOrg — 404 if not the caller's own CRM client)
      │
Validate not already provisioned (client.workspaceOrganizationId — 409 if set)
      │
BEGIN TRANSACTION
      │
  Create Organization (type=CLIENT, status=TRIAL)
      │
  Conditional UPDATE client SET workspaceOrganizationId = ...
    WHERE workspaceOrganizationId IS NULL   ← race guard
      │
  count != 1? → throw (rolls back the Organization just created)
      │
  Find-or-create ClientOnboarding, mark WORKSPACE_CREATED complete
      │
COMMIT
      │
Audit: WORKSPACE_PROVISIONED
```

If any step fails, the whole transaction rolls back — no partially-created workspace, no client pointing at a half-initialized organization.

## Idempotency & concurrency (§14/§15)

Two protections, because a single pre-transaction check cannot by itself close every race window:

1. **Conditional `updateMany`** inside the transaction (`WHERE workspaceOrganizationId IS NULL`) — if two requests both pass the initial "not yet provisioned" read, only one's conditional update affects a row; the other gets `count !== 1` and throws, rolling back its own transaction.
2. **Caught `P2002`** around the transaction — the new workspace's `slug` uniqueness check runs *before* the transaction (so a nice human-readable slug can be chosen), which means two concurrent requests can compute the same slug before either commits and collide on `organizations.slug` itself, before ever reaching guard 1. This is caught and folded into the same clean `409 ConflictError`, not a raw database error surfaced to the caller.

A dedicated regression test (`tests/integration/workspaceProvisioning.test.ts`, "concurrency: two simultaneous provisioning requests...") fires two `Promise.all`-concurrent provision calls for the same client and asserts exactly one `201` and one `409`, with exactly one `Organization` row created. The same pattern (conditional update + caught unique-constraint race) is applied to invitation acceptance — see the invitation section below.

## Client-admin invitation (§18-23)

`WorkspaceInvitation` — same at-rest security posture as `PasswordResetToken`/`Session.tokenHash`: the raw `art_invite_...` token is generated server-side (32 bytes, `crypto.randomBytes`), only its SHA-256 hash is ever persisted, and it is never logged. Fields: `organizationId` (the workspace), `email`, `roleId` (always resolves to the fixed `ADMIN` role — see below), `expiresAt` (default 72h, `INVITATION_TOKEN_TTL_HOURS`), `acceptedAt`/`acceptedUserId`, `revokedAt`. No stored status enum: `PENDING`/`ACCEPTED`/`REVOKED`/`EXPIRED` is derived from those three timestamp columns at read time.

**Role (§20)**: the invited administrator always receives the platform's existing `ADMIN` role (organization-scoped, not `SUPER_ADMIN`) — a fixed server-side constant, never read from the request body. The create-invitation schema doesn't expose a role field at all, so there is no parameter for a client to manipulate into requesting `SUPER_ADMIN` or any platform-level role.

**Single-use / revocation / expiry (§19)**: enforced by the same three timestamp checks everywhere the invitation is read (`computeInvitationStatus`), never trusted from a client-supplied flag. Creating a new invitation to the same `(workspace, email)` pair revokes any prior outstanding one (mirrors `passwordResetRepository.invalidateAllForUser`); a hand-added partial unique index (`workspace_invitations_one_pending_per_email`) is the DB-level backstop against two concurrently-outstanding invitations racing past that application-level revoke.

**Acceptance transaction (§21)**:

```
Load invitation by token hash — PENDING only, else generic "invalid or expired" (401)
      │
Existing user for this email?
  yes → skip identity creation, preserve the account as-is (§22)
  no  → require a password, create User with the invitation's fixed role (§23)
      │
BEGIN TRANSACTION
      │
  Create/skip User (see above)
      │
  Create OrganizationMembership if one doesn't already exist for this (user, workspace)
      │
  Conditional UPDATE invitation SET acceptedAt = now()
    WHERE acceptedAt IS NULL AND revokedAt IS NULL   ← race guard
      │
  count != 1? → throw (rolls back any User/membership just created)
      │
COMMIT
      │
Issue a real session (same session-creation path as login)
Audit: CLIENT_ADMIN_ACCEPTED
Mark ADMINISTRATOR_ACCEPTED on the client's onboarding record, if any
```

Same two-layer race protection as provisioning: the conditional `updateMany` on the invitation row, plus a caught `P2002` on `User.email` for the case where two concurrent acceptances of a brand-new invitee's email both pass the pre-transaction existence check before either commits. A dedicated concurrency test proves exactly one user and one membership result from two simultaneous acceptances of the same token.

## Security boundary (§12)

Provisioning, invitation-sending, and workspace-lifecycle mutation all require the caller to be a member of the CRM-owning organization with the matching permission (`workspaces.create`, `invitations.create`, `workspaces.suspend`, etc.) — resolved from the caller's own session, never a request-supplied organization id. A workspace member (the invited client administrator) has no route in this API that lets them provision another workspace, invite themselves into a different workspace, or self-assign a platform role — `workspaces.*`/`invitations.*`/`onboarding.*` permissions are granted only to the platform-operator roles (ADMIN/MANAGER on Artify HQ's own organization) in `prisma/rolePermissionSeed.ts`, and every workspace-scoped route re-derives ownership via `workspaceRepository.findByIdForOwner`, returning 404 (never 403) for a workspace outside the caller's CRM-owning organization.

## Known limitations

- No real email delivery — invitation links are returned as `devToken` outside production only (Phase 13 integration point, same as password reset).
- Currency defaults to `USD`, not OMR, unless explicitly requested at provisioning time — deliberate per §17; Artify's own seed data still uses OMR for its bootstrap organization, which is unrelated to this default.
- Workspace configuration is foundational only — no product/subscription/billing settings exist yet to configure.
