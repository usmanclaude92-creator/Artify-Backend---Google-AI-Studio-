# Phase 10 — Subscriptions, Billing & Client Portal Integration

Implementation notes, scoped to the brief: the production commercial layer — CRM Client → Contract (with variations) → Subscription → Invoice → Payment — plus a read-only Client Portal built entirely on the existing CRM/session architecture. No live payment gateway, no recurring/scheduled-invoice workers, no public website integration, no AI. See `docs/COMMERCIAL_ARCHITECTURE.md`, `docs/BILLING_ARCHITECTURE.md`, `docs/CLIENT_PORTAL_ARCHITECTURE.md` for the architecture and `docs/PHASE_10_COMPLETION_REPORT.md` for status.

## What changed, and why

### 1. Inspection findings
`Contract`/`Subscription`/`SubscriptionItem`/`Invoice`/`InvoiceItem` already existed as Phase 2 placeholder models with zero application code and zero rows in every environment (verified before touching anything). `subscriptions.read/manage`, `billing.read/manage` were already-seeded, never-enforced placeholder permissions. No `Payment` model, no `ContractVariation` model, no invoice/contract/subscription numbering scheme existed. This phase evolves the existing schema rather than replacing it, exactly as Phase 9 did for `MediaAsset`.

### 2. Database migrations
Two files, in order, because Postgres forbids using a brand-new enum value within the transaction that adds it:
- `prisma/migrations/20261001000000_phase10_enum_values/` — `ALTER TYPE ... ADD VALUE` only (`BillingCycle.ONE_TIME/QUARTERLY`, `ContractStatus.SUSPENDED`, `SubscriptionStatus.DRAFT/PAUSED`).
- `prisma/migrations/20261001000001_phase10_commercial_billing/` — everything else: `InvoiceStatus.SENT` renamed to `ISSUED` (data-preserving `CASE`-based remap, not a bare cast — a bare cast would fail on any pre-existing `SENT` row), `PARTIALLY_PAID`/`CANCELLED` added; `contracts.title`, `invoice_items.line_total`, `invoices.amount_due`, `subscriptions.subscription_number` added via the established nullable-then-backfill-then-`NOT NULL` pattern (a genuine upgrade-path test against representative pre-Phase-10 data caught two bugs in the naive Prisma-diff output here — see `docs/PHASE_10_COMPLETION_REPORT.md`); new `contract_variations` and `payments` tables; three `SEQUENCE`s (`contract_number_seq`, `subscription_number_seq`, `invoice_number_seq`) for race-safe numbering; CHECK constraints for every financial invariant (positive amounts, non-negative balances, consistent reversal fields, etc.).

Verified both as a genuine upgrade (a scratch database seeded with pre-Phase-10-shaped rows, including an old `SENT` invoice status, migrated forward and asserted correct) and from a clean database (all 10 migrations apply in order).

### 3. Financial primitives
`server/utils/money.ts` — every authoritative monetary value is a `Prisma.Decimal` end to end (`NUMERIC(18,3)` in Postgres), never a JS `number`. `roundMoney` (ROUND_HALF_UP, 3 decimal places — OMR's minor unit), `addMoney`/`subtractMoney`/`sumMoney`/`multiplyMoney`, `assertSameCurrency` (no arithmetic is ever performed across two different currencies), `formatMoney` (display only). `server/services/billingCalculations.ts` is the single place invoice/contract math happens — `calculateLineItem`, `calculateInvoiceTotals`, `calculateInvoiceBalance`, `calculateContractCurrentValue`, `effectiveInvoiceStatus` — called by services, never duplicated in a route handler or the frontend. `server/utils/sequence.ts` wraps the three Postgres sequences (`nextContractNumber`/`nextSubscriptionNumber`/`nextInvoiceNumber`) — atomic, gap-tolerant, genuinely race-safe under concurrent creation (proven by dedicated concurrency tests, not assumed).

### 4. Backend additions
Repositories (`contractRepository`, `subscriptionRepository`, `invoiceRepository`, `paymentRepository`) follow the established `findByIdInOrg`-only convention and expose race-safe conditional `transitionStatus` methods (same pattern as Phase 5-9's conditional-`updateMany`-plus-row-count). Contract variation creation row-locks the parent contract (`SELECT ... FOR UPDATE`) before computing the next sequential `variationNumber`. Payment recording and reversal row-lock the parent invoice for the same reason — both read a computed sum (Σ completed payments) and validate against it before writing, which a plain conditional update cannot express.

Services: `contractService` (CRUD, activate/suspend/terminate, variation creation, computed-on-read `currentValue`), `subscriptionService` (CRUD, activate/pause/cancel, product/module validation), `invoiceService` (creation with line-item calculation, DRAFT-only editing, issue with immutability lock-in, void/cancel, transactional payment recording with overpayment rejection), `paymentService` (list/detail, transactional reversal), `clientPortalService` (read-only, resolves the caller's session organization to its Client row — see `docs/CLIENT_PORTAL_ARCHITECTURE.md`).

### 5. Endpoints

```
GET/POST      /api/v1/contracts                    contracts.read / contracts.create
PATCH         /api/v1/contracts/:id                 contracts.update
POST          /api/v1/contracts/:id/activate        contracts.activate
POST          /api/v1/contracts/:id/suspend         contracts.suspend
POST          /api/v1/contracts/:id/terminate        contracts.terminate
POST          /api/v1/contracts/:id/variations       contracts.variations.create
GET/POST      /api/v1/subscriptions                 subscriptions.read / subscriptions.create
PATCH         /api/v1/subscriptions/:id              subscriptions.update
POST          /api/v1/subscriptions/:id/activate     subscriptions.activate
POST          /api/v1/subscriptions/:id/pause        subscriptions.pause
POST          /api/v1/subscriptions/:id/cancel       subscriptions.cancel
GET/POST      /api/v1/invoices                       invoices.read / invoices.create
PATCH         /api/v1/invoices/:id                    invoices.update
POST          /api/v1/invoices/:id/issue              invoices.issue
POST          /api/v1/invoices/:id/void               invoices.void
GET/POST      /api/v1/invoices/:id/payments           payments.read / payments.create
GET           /api/v1/payments                        payments.read
GET           /api/v1/payments/:id                    payments.read
POST          /api/v1/payments/:id/reverse            payments.reverse
GET           /api/v1/portal/dashboard                portal.dashboard.read
GET           /api/v1/portal/contracts[/:id]          portal.contracts.read
GET           /api/v1/portal/subscriptions[/:id]      portal.subscriptions.read
GET           /api/v1/portal/invoices[/:id]           portal.invoices.read
GET           /api/v1/portal/payments                 portal.payments.read
```

### 6. RBAC
26 new permission keys. The pre-existing `subscriptions.read` (Phase 2) is reused, not duplicated; the never-enforced placeholders `subscriptions.manage`, `billing.read`, `billing.manage` are retired (verified zero real usage first — same "verify zero usage, then retire" pattern as Phase 7's `products.delete` → `products.archive`) in favor of the granular set. Sensitive financial actions (activate/suspend/terminate/variations.create on contracts; issue/void on invoices; reverse on payments) are deliberately separate permissions from read/create/update — `invoices.read` never implies `invoices.issue`, `payments.read` never implies `payments.reverse`. ADMIN gets the full set; MANAGER gets read/create/update plus the reversible subscription transitions but none of the sensitive contract/invoice/payment actions; USER and VIEWER get read-only. All four internal roles get every `portal.*` key — the real security boundary is `clientPortalService` resolving the caller's own session organization, not the permission tier (see `docs/CLIENT_PORTAL_ARCHITECTURE.md`).

### 7. Client Portal
`Contract`/`Subscription`/`Invoice`/`Payment.organizationId` is always the agency's own internal organization — the same org that owns the `Client` CRM record — never the client's own provisioned workspace organization. `clientPortalService` resolves `Client.workspaceOrganizationId = session.organizationId` to find the one `Client` row the caller's current session belongs to, then scopes every query by that `Client`'s id. Reuses the existing Phase 3 `switchOrganization` mechanism — no second client-auth system. An agency staffer viewing their own internal org naturally finds no matching `Client` row and is rejected (403), with no different failure mode that would leak which case it is.

### 8. Frontend
`src/lib/api.ts` gained `contractsApi`/`subscriptionsApi`/`invoicesApi`/`paymentsApi`/`portalApi` and their types (every monetary field is the server's Decimal string, formatted for display via the new `src/lib/money.ts`, never parsed back into a JS number for calculation). `src/components/ui/ui.tsx` gained `ReasonConfirmDialog` — a proper modal collecting a required free-text reason inside the same dialog, used by every action requiring one (terminate/cancel/void/reverse). New Control Center pages: `ContractsPage.tsx`, `SubscriptionsPage.tsx`, `InvoicesPage.tsx`, `PaymentsPage.tsx` (a new "Commercial" nav section) and `ClientPortalPage.tsx` (a new "Client Portal" nav section, tabbed dashboard/contracts/subscriptions/invoices/payments, read-only by construction — no create/update/issue/void/reverse control exists anywhere on it).

### 9. Deliberate Phase 10 scope boundaries
No live payment gateway (Stripe/PayPal) — payments are recorded manually. No recurring/scheduled invoice generation worker (explicit manual `POST /invoices` only) and no overdue-flagging worker — `OVERDUE` is computed on every read (`effectiveInvoiceStatus`) from the stored status plus due date, never written to the `status` column. No PDF generation — invoice detail is a structured API/UI view. No tax-compliance claims — `tax`/`discount` are plain Decimal fields, not a compliance engine.
