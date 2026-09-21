# Commercial Architecture (Phase 10)

## Concept boundaries

CRM `Client` → `Organization`/`Workspace` (Phase 6) → `Product`/`ProductModule` (Phase 7) → `Contract`/`ContractVariation` → `Subscription`/`SubscriptionItem` → `Invoice`/`InvoiceItem` → `Payment` are kept explicitly distinct — never collapsed into one another. `Contract`, `Subscription`, `Invoice`, and `Payment` all carry `organizationId` referring to the **agency's own** internal organization (the same org that owns the `Client` row via `Client.organizationId`), not the client's own provisioned workspace organization (`Client.workspaceOrganizationId`, Phase 6). See `docs/CLIENT_PORTAL_ARCHITECTURE.md` for why this distinction matters.

```
Organization (agency)
  └─ Client
       ├─ Contract ── ContractVariation[]
       │     └─ Invoice[] (optional contractId link)
       ├─ Subscription ── SubscriptionItem[]
       │     └─ Invoice[] (optional subscriptionId link)
       └─ Invoice[] ── InvoiceItem[]
              └─ Payment[]
```

All five models are organization-scoped and follow the established `findByIdInOrg`-only repository convention (no bare `findById` anywhere in `contractRepository`/`subscriptionRepository`/`invoiceRepository`/`paymentRepository`).

## Contract

| Field | Notes |
|---|---|
| `contractNumber` | server-generated, `CTR-######`, from `contract_number_seq` (race-safe under concurrent creation) |
| `title`, `description`, `notes` | free text |
| `status` | `DRAFT \| ACTIVE \| SUSPENDED \| EXPIRED \| TERMINATED` — server-controlled only |
| `startDate`, `endDate` | dates |
| `contractValue`, `currency` | the **original** value, `NUMERIC(18,3)`, never overwritten |

**Status lifecycle**: `DRAFT`/`SUSPENDED` → `ACTIVE` (`POST /contracts/:id/activate`), `ACTIVE` → `SUSPENDED` (`POST /contracts/:id/suspend`), any non-terminal status → `TERMINATED` (`POST /contracts/:id/terminate`, requires a reason). The generic `PATCH` never touches `status` or `contractValue` — Zod's `updateContractSchema` doesn't even declare those fields, so a request that tries is silently stripped and, with nothing left to update, rejected as a 400. `EXPIRED` is a defined enum value with no reachable transition in this phase (no scheduled-expiry worker — Phase 13).

### ContractVariation

Never overwrites `Contract.contractValue`. Each variation is its own immutable row: `variationNumber` (sequential per contract, `@@unique([contractId, variationNumber])`), `amount` (signed — positive increases, negative reduces — `<> 0` enforced by a CHECK constraint), `effectiveDate`, `reason`, `createdBy`. The contract's **current** value is always `contractValue + Σ(variations.amount)`, computed on every read (`billingCalculations.calculateContractCurrentValue`) — **never cached on the `Contract` row**, so there is exactly one source of truth and no cache-consistency surface to maintain. `variationNumber` assignment row-locks the parent `Contract` (`SELECT ... FOR UPDATE`) inside a transaction before computing `MAX(variationNumber) + 1`, so N concurrent variation creates against the same contract each get a unique sequential number — proven by a dedicated concurrency test, not assumed.

## Subscription

| Field | Notes |
|---|---|
| `subscriptionNumber` | server-generated, `SUB-######`, from `subscription_number_seq` |
| `productId` | references the platform-global `Product` catalog (Phase 7) |
| `status` | `DRAFT \| TRIALING \| ACTIVE \| PAST_DUE \| PAUSED \| CANCELLED \| EXPIRED` — server-controlled only |
| `billingCycle` | `ONE_TIME \| MONTHLY \| QUARTERLY \| ANNUAL` |
| `price`, `currency` | this subscription's own snapshot at creation time |
| `cancelledAt`, `cancellationReason`, `cancelledById` | set only by `POST /subscriptions/:id/cancel` |

`price` and every `SubscriptionItem.unitPrice` are captured at creation time and never derived from a live `Product`/`ProductModule` price list — there isn't one (Product/ProductModule carry no price field in this codebase — see `docs/PRODUCT_CATALOG_ARCHITECTURE.md`), so a later product change can never silently rewrite an existing subscription's economics. `SubscriptionItem.productModuleId`, when supplied, is validated to actually belong to the subscription's own `productId` (`productModuleRepository.findByIdForProduct`) — a module id from a different product is structurally unreachable.

**Status lifecycle**: `DRAFT`/`TRIALING`/`PAUSED` → `ACTIVE` (`.../activate`), `ACTIVE`/`PAST_DUE` → `PAUSED` (`.../pause`), any non-terminal status → `CANCELLED` (`.../cancel`, requires a reason). `PAST_DUE` has no reachable transition into it in this phase (that requires the Phase 13 billing-cycle worker this phase deliberately excludes).

## RBAC

Sensitive transitions are deliberately separate permissions from read/create/update, never implied by them: `contracts.activate/suspend/terminate/variations.create`, `subscriptions.activate/pause/cancel` (the last three are *not* considered equally sensitive — MANAGER is granted them, unlike the contract-side actions). See `docs/PHASE_10_IMPLEMENTATION.md` §6 for the full tiering.

## Audit

Every lifecycle transition and variation creation is recorded via the unmodified `auditLogRepository.record()`: `CONTRACT_CREATED/UPDATED/ACTIVATED/SUSPENDED/TERMINATED/VARIATION_CREATED`, `SUBSCRIPTION_CREATED/UPDATED/ACTIVATED/PAUSED/CANCELLED`.
