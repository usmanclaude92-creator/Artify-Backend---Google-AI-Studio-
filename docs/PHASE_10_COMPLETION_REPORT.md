# Phase 10 Completion Report — Subscriptions, Billing & Client Portal Integration

Scope: the production commercial layer — CRM Client → Contract (with variations) → Subscription → Invoice → Payment — with Decimal-exact financial math, race-safe numbering, immutable issued invoices, non-deletable payments (reversal only), and a read-only Client Portal built on the existing CRM/session architecture. No live payment gateway, no recurring/scheduled billing workers, no public website integration, no AI — see `docs/PHASE_10_IMPLEMENTATION.md` for the exact boundary.

## Phase Status: **COMPLETE**

## Implemented
- **Financial primitives**: `Prisma.Decimal` end to end (`NUMERIC(18,3)`), never a JS float for an authoritative value; a single calculation engine (`billingCalculations.ts`) is the only place invoice/contract math happens.
- **Contracts**: server-generated numbering, server-controlled lifecycle (`activate`/`suspend`/`terminate`, each a dedicated endpoint), and immutable-value variations — `currentValue` computed on every read, never cached.
- **Subscriptions**: server-generated numbering, server-controlled lifecycle (`activate`/`pause`/`cancel`), price/item snapshots independent of any later product change.
- **Invoices**: server-generated race-safe numbering, DRAFT-editable/immutable-once-issued, line-item snapshots, `amountPaid`/`amountDue` always recomputed transactionally from persisted `Payment` rows, `OVERDUE` computed on read (never a stored status).
- **Payments**: multiple payments per invoice, overpayment rejected outright (never silently capped), reversal preserves the row (fields-on-row, never deleted), row-locked recording/reversal proven race-safe under concurrent load.
- **Client Portal**: read-only dashboard/contracts/subscriptions/invoices/payments, resolved entirely server-side from the caller's own session organization — no client-supplied id ever trusted, structural cross-organization isolation.
- **RBAC**: 26 new permission keys; sensitive financial actions (activate/suspend/terminate/variations.create, issue/void, reverse) are separate permissions, never implied by read/create/update.
- **Control Center**: new "Commercial" section (Contracts/Subscriptions/Invoices/Payments) and "Client Portal" section, all real API data.

## Architecture / Security Decisions
- Every authoritative monetary value is `Prisma.Decimal` from the Postgres column through to the API response — `0.100 + 0.200` is asserted to equal exactly `0.300` in `tests/unit/money.test.ts`, not the native-float `0.30000000000000004`.
- Contract/subscription/invoice numbering uses real Postgres `SEQUENCE`s (`nextval()`), chosen specifically because the brief demands genuine race-safety under concurrent creation — proven, not assumed, by dedicated concurrency tests for all three.
- Invoice issuance and payment recording/reversal reuse the established conditional-`updateMany`-plus-row-count pattern (Phase 5+) for simple transitions, and `SELECT ... FOR UPDATE` row-locking transactions for the two operations (payment record/reverse) that read a computed sum before validating against it — a plain conditional update cannot express "must not exceed the outstanding balance."
- The Phase 10 permission-key addition surfaced a real naming collision with a pre-existing Phase 2 placeholder (`subscriptions.read` already existed, alongside never-enforced `subscriptions.manage`/`billing.read`/`billing.manage`); resolved by deduplicating the key and retiring the three placeholders after verifying zero real usage — the same pattern as Phase 7's `products.delete` → `products.archive`.
- The Client Portal deliberately reuses the Phase 3 `switchOrganization` session mechanism rather than building a second client-auth system; the access boundary is `clientPortalService`'s `Client`-resolution step, not the permission tier (`portal.*` is granted to every internal role) — see `docs/CLIENT_PORTAL_ARCHITECTURE.md`.

## Tests
- **Backend: 390/390 passing** (up from 317 at Phase 10's start), 40 files — 73 new this phase: `tests/unit/money.test.ts` (19: Decimal float-precision traps, rounding, currency validation, calculation-engine correctness), `tests/integration/contracts.test.ts` (13: CRUD, lifecycle state machine, variation history/current-value reconstruction, variation-numbering concurrency, RBAC tiers, cross-organization IDOR), `tests/integration/subscriptions.test.ts` (10: CRUD, product/module validation, lifecycle, numbering concurrency, RBAC, IDOR), `tests/integration/invoices.test.ts` (13: Decimal-exact totals, numbering concurrency, issue immutability, void/cancel, authorization separation, IDOR), `tests/integration/payments.test.ts` (12: multiple payments, overpayment rejection, reversal, concurrent-payment row-locking, authorization separation, IDOR), `tests/integration/clientPortal.test.ts` (6: dashboard/list/detail read access, cross-organization isolation between two independent clients, internal-org rejection, mutation-endpoint rejection for a VIEWER-tier client user). 317 carried over unmodified.
- **Frontend: 163/163 passing** (up from 121), 24 files — 42 new: `ContractsPage.test.tsx` (10), `SubscriptionsPage.test.tsx` (8), `InvoicesPage.test.tsx` (10), `PaymentsPage.test.tsx` (7), `ClientPortalPage.test.tsx` (7) — list/detail rendering of real API data, create/lifecycle-action forms, permission-gated controls, empty/error states, and (portal) confirmation that no mutation control exists anywhere on the page. 121 carried over unmodified; one existing test (`permissions.test.ts`'s nav-permission-shape assertion) was widened, not weakened, to admit Phase 10's `portal.<domain>.read` three-segment keys alongside the existing two-segment shape.
- **Build**: backend TypeScript **PASS**, frontend TypeScript **PASS**, ESLint **PASS**, frontend production build **PASS**, full server bundle **PASS**.

## Financial Calculation Tests
- Decimal precision: `0.100 + 0.200 === 0.300` exactly, quantity × price multiplication, sum-of-many-fractional-amounts, ROUND_HALF_UP boundary cases — all in `tests/unit/money.test.ts`.
- Line/invoice totals, balance recalculation, contract current-value reconstruction — `tests/unit/money.test.ts`'s `billingCalculations` suite plus end-to-end assertions in `tests/integration/invoices.test.ts`/`contracts.test.ts` against real persisted rows.
- Currency-mismatch rejection (`assertSameCurrency`) verified both as a unit test and as an integration test (a payment in a different currency than its invoice is rejected 400).

## Concurrency Tests
- **Numbering**: 5-8 simultaneous contract/subscription/invoice creations each receive a unique, non-duplicated sequence-backed number (`tests/integration/contracts.test.ts`, `subscriptions.test.ts`, `invoices.test.ts`).
- **Contract variations**: 5 simultaneous variation creates against one contract each get a unique sequential `variationNumber`, none lost (`tests/integration/contracts.test.ts`).
- **Payments**: 4 simultaneous payments against one invoice — the row lock serializes them so the sum of `COMPLETED` payments never exceeds the invoice total; exactly the number that fit succeed, the rest are clean 400 rejections, not partial writes (`tests/integration/payments.test.ts`).

## Security Regression
- Full existing backend suite (auth, sessions, org switching, RBAC, CRM, onboarding, product catalog, CMS, media/storage authorization, audit logs, optimistic concurrency, webhook security, rate limiting, CORS, Helmet, API error handling) re-ran unmodified as part of the 390/390 total — zero regressions.
- Grep sweep across every new Phase 10 file for fabricated/mock data, `localStorage`-based role/admin patterns, and unscoped `findUnique` on the new tenant-owned commercial models — zero matches; the only two bare `findUniqueOrThrow` calls (`invoiceService.recordPayment`, `paymentService.reversePayment`) occur inside a transaction re-reading a row already organization-verified and row-locked earlier in the same call, not an independent lookup surface.
- IDOR coverage: every new resource (contract, subscription, invoice, payment) has a dedicated cross-organization test confirming a different organization's caller gets 404, not the record.
- Client Portal isolation: unauthenticated access, an agency staffer's own-org rejection, cross-client-workspace isolation, and mutation-endpoint rejection for a read-only client user are all directly tested (`tests/integration/clientPortal.test.ts`).

## Database
- **Migrations**: `prisma/migrations/20261001000000_phase10_enum_values/` (enum value additions, split into their own file per Postgres's same-transaction restriction) then `prisma/migrations/20261001000001_phase10_commercial_billing/` (everything else — see `docs/PHASE_10_IMPLEMENTATION.md` §2 for the full list).
- **Clean-from-zero**: verified — all 10 migrations apply in order against a from-scratch database.
- **Upgrade**: verified against a scratch database seeded with representative pre-Phase-10 data (including an old `InvoiceStatus.SENT` row) migrated forward — caught and fixed two real bugs the naive Prisma-diff output would have shipped broken (the `SENT → ISSUED` enum rename needed an explicit `CASE` remap, not a bare cast; several new `NOT NULL` columns needed the nullable-then-backfill-then-lock pattern, with `invoice_items.line_total` backfilled from the outgoing `amount` column *before* it was dropped, not after).
- `npx prisma validate` / `migrate status` against `artify_dev`: **PASS**.
- Pre-existing data (CRM/users/organizations/memberships/products/product modules/CMS/media/audit logs) confirmed intact after migrating — no reset, no `db push`, at any point.

## Payment/Gateway Status
No live payment gateway integration exists or was added — payments are recorded manually via `POST /invoices/:id/payments`, matching the brief's explicit "no live payment gateway processing unless already required." No SDK, no card data, no PCI-sensitive handling anywhere in this codebase.

## Supabase
No live Supabase connectivity was available in this build's sandbox (the same environmental network limitation documented for Postgres/object storage since Phase 2/9 — no outbound path to Supabase from here). All work was verified against local PostgreSQL; no Supabase credentials were invented, referenced, or committed. This limitation is unchanged from every prior phase and does not block Phase 10's completion, which does not require live Supabase access.

## Commit
`d848174` on `claude/busy-franklin-rdwttk`.

## Branch
`claude/busy-franklin-rdwttk`

## Blockers
None outstanding except the pre-existing, environmental Supabase/cloud connectivity gap noted above.

## Phase 11: NOT STARTED
