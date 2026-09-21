# Billing Architecture (Phase 10)

## Financial correctness

Every authoritative monetary value, end to end — from the Postgres column (`NUMERIC(18,3)`) through every service calculation to the API response — is a `Prisma.Decimal` (`decimal.js` under the hood). A native JS `number` (float) never touches an authoritative financial value; `toFixed()` is never used as a rounding source of truth. Default currency is OMR, displayed as `OMR 1,250.000` (`server/utils/money.ts::formatMoney`, display only — never a calculation input), stored with exactly 3 decimal places (`MONEY_DECIMALS`, ROUND_HALF_UP). `Prisma.Decimal` serializes to JSON as a string automatically (`toJSON()`) — unlike `MediaAsset.sizeBytes`'s `BigInt` (Phase 9), no manual conversion is needed at the repository boundary.

`assertSameCurrency` rejects any operation that would combine two different currencies' amounts — every payment/invoice pairing is checked before arithmetic, never silently coerced.

### The calculation engine

`server/services/billingCalculations.ts` is the **only** place invoice/contract math happens:

```
lineTotal   = round(quantity × unitPrice − discount)
subtotal    = round(Σ lineTotal)
total       = round(subtotal − invoiceDiscount + tax)
amountDue   = round(total − amountPaid)     (amountPaid = Σ COMPLETED payment amounts)
currentValue = contractValue + Σ(variations.amount)
```

`invoiceService`/`paymentService`/`clientPortalService` all call these functions; none duplicates the arithmetic, and the frontend never performs an authoritative calculation — it may preview a total for UX (see `InvoiceFormModal` in `InvoicesPage.tsx`), but the server always recomputes and is the only value ever persisted.

## Invoice

| Field | Notes |
|---|---|
| `invoiceNumber` | server-generated, `INV-######`, from `invoice_number_seq` — race-safe, never client-supplied, never timestamp-derived |
| `status` | `DRAFT \| ISSUED \| PARTIALLY_PAID \| PAID \| OVERDUE \| VOID \| CANCELLED` — server-controlled only |
| `subtotal`, `tax`, `discount`, `total` | computed by `calculateInvoiceTotals`, never trusted from a request body |
| `amountPaid`, `amountDue` | cached, **always** recomputed transactionally from the invoice's own `Payment` rows on every payment record/reversal — never trusted from a request body |

**`OVERDUE` is a computed effective state, never a column a background job flips.** `billingCalculations.effectiveInvoiceStatus(invoice)` derives it on every read from the stored `status` (`ISSUED`/`PARTIALLY_PAID`) plus `dueDate < now`; the API always returns both the raw `status` and the computed `effectiveStatus`, and the raw column is never literally set to `OVERDUE` by any code path.

**Lifecycle**: `POST /invoices` always creates `DRAFT` (freely editable — line items, dates, discount, tax). `POST /invoices/:id/issue` transitions `DRAFT → ISSUED`, requires at least one line item, and is a race-safe conditional update (`WHERE id = ? AND status = 'DRAFT'`). **Once issued, an invoice is immutable** — line prices/quantities/totals/currency/issued date can no longer change; `PATCH` on a non-`DRAFT` invoice is rejected (409). `POST /invoices/:id/void` transitions `DRAFT → CANCELLED` or `ISSUED/PARTIALLY_PAID/OVERDUE(effective) → VOID`, requires a reason, and is blocked (409) while the invoice has any completed payment — reverse the payments first. `PARTIALLY_PAID`/`PAID` are **never** set by a caller; they're the direct output of `calculateInvoiceBalance` inside the payment-recording/reversal transaction.

### InvoiceItem — historical snapshots

`description`/`unitPrice`/`discount`/`lineTotal` are captured at invoice-creation time and never change after issuance, regardless of any later change to the referenced `Product`/`ProductModule` — a published, issued invoice's numbers are permanent history. `productModuleId`, when supplied against a subscription-linked invoice, is validated to belong to that subscription's product.

## Payment

| Field | Notes |
|---|---|
| `status` | `PENDING \| COMPLETED \| FAILED \| REVERSED` |
| `amount` | `> 0`, CHECK-constrained at the database level |
| `reversalReason`, `reversedAt`, `reversedById` | set together, only by `POST /payments/:id/reverse`; a CHECK constraint (`payments_reversal_fields_consistent`) enforces they're all-set-or-all-null in lockstep with `status = REVERSED` |

**Never deleted, ever** — a `Payment` row is permanent once created. Correction is exclusively via reversal: the same row gains its reversal fields, its core fields (`amount`/`date`/`method`) never change, and a `REVERSED` payment simply stops counting toward `Invoice.amountPaid`. "Reference to the original payment" (per the brief) is trivially satisfied — reversal is the same row, not a separate linked record.

### Recording a payment (`POST /invoices/:id/payments`)

Inside one transaction:
1. Row-lock the parent `Invoice` (`SELECT ... FOR UPDATE`) — serializes concurrent payments against the same invoice.
2. Re-read the invoice's current status (rejects if not `ISSUED`/`PARTIALLY_PAID`) and sum its `COMPLETED` payments.
3. Reject outright (never silently cap) if the new amount would exceed the outstanding balance.
4. Create the `Payment` (`COMPLETED`), recompute `amountPaid`/`amountDue`/`status`, all in the same transaction.

A dedicated concurrency test fires several simultaneous payments against one invoice and asserts the total `amountPaid` never exceeds `total` and the rejected requests are clean 400s, not partial writes.

### Reversing a payment (`POST /payments/:id/reverse`)

Same row-lock-the-invoice-first pattern; only a `COMPLETED` payment can be reversed (a conditional update, 0-rows-affected means someone else already reversed it — reported as 409, not silently ignored); the invoice's `amountPaid`/`amountDue`/`status` are recomputed from the remaining `COMPLETED` payments in the same transaction.

## Numbering

`contract_number_seq`/`subscription_number_seq`/`invoice_number_seq` are real Postgres `SEQUENCE`s (`server/utils/sequence.ts`), not application-level retry-on-conflict and not a timestamp — `nextval()` is atomic at the database level, so concurrent callers can never receive the same value. Format: `CTR-000001`, `SUB-000001`, `INV-000001` (zero-padded to 6 digits). Proven under real concurrent creation by dedicated tests, not merely asserted.

## RBAC

`invoices.read` does **not** imply `invoices.issue`/`invoices.void`; `payments.read` does **not** imply `payments.reverse` — every sensitive financial action is its own separate permission. See `docs/PHASE_10_IMPLEMENTATION.md` §6.

## Audit

`INVOICE_CREATED/UPDATED/ISSUED/VOIDED/CANCELLED`, `PAYMENT_RECORDED/REVERSED` — actor, organization, timestamp, resource, and the relevant before/after financial values (amounts as Decimal strings, never floats). Reversal audit entries carry the reason. No card numbers, bank credentials, or payment-provider secrets are ever logged (there are none in this codebase — payments are recorded manually, never processed through a live gateway).
