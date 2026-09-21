# ADR-012: Financial Decimal Precision

## Status
Accepted (Phase 2)

## Context
`docs/DATABASE_DESIGN.md` (Phase 0) already recommended `NUMERIC` over float for money; Phase 2 requires the decision actually be implemented and enforced, with 3-decimal precision for currencies like OMR that don't use 2 decimal places, and explicitly forbids `FLOAT`/`REAL`/`DOUBLE PRECISION` for any monetary column.

## Decision
Every monetary column in `prisma/schema.prisma` (`Contract.contractValue`, `Subscription.price`, `SubscriptionItem.unitPrice`, `Invoice.subtotal`/`tax`/`discount`/`total`, `InvoiceItem.unitPrice`/`amount`) is typed `Decimal @db.Decimal(18, 3)` — exact fixed-point storage, 18 total digits, 3 after the decimal point (covers OMR's 3-decimal-place `baisa` subdivision and every 2-decimal currency without a schema change per currency). Currency itself is `CHAR(3)` (ISO 4217 code) on every monetary row — never implied or defaulted from context.

Application code reads these as Prisma's `Decimal` type (backed by `decimal.js`), never as a JS `number` — no monetary value is ever passed through native floating-point arithmetic.

Non-negativity is enforced at the database level via `CHECK` constraints (`prisma/migrations/.../migration.sql`'s hand-added section — Prisma's schema DSL has no native `CHECK` syntax), not application validation alone: `contracts_contract_value_non_negative`, `invoices_subtotal_non_negative`, `invoices_tax_non_negative`, `invoices_discount_non_negative`, `invoices_total_non_negative`, `invoice_items_unit_price_non_negative`, `invoice_items_amount_non_negative`, `subscriptions_price_non_negative`, `subscription_items_unit_price_non_negative`. Quantities get a parallel `CHECK (quantity > 0)`.

## Consequences
- `tests/integration/schemaConstraints.test.ts`'s "preserves exact decimal precision" test proves `1000.125` round-trips through the database exactly (string comparison, not approximate float equality) and that a negative `contract_value` is rejected by Postgres itself, not just by application code — i.e. the constraint holds even if a future bug or a bypassed API call tries to write one directly.
- Any future arithmetic on these values (invoice totals, prorated billing, tax calculation — none implemented in Phase 2) must use `Prisma.Decimal`'s arithmetic methods, not `+`/`-`/`*` on numbers coerced from them.

## Alternatives considered
- `FLOAT`/`DOUBLE PRECISION`: rejected outright — binary floating point cannot represent most decimal fractions exactly (`0.1 + 0.2 !== 0.3`), which is unacceptable for money and explicitly forbidden by the brief.
- Storing amounts as integer minor units (e.g. cents/baisas as `BIGINT`): a legitimate alternative used by some payment systems; rejected here because `NUMERIC(18,3)` is equally exact, more directly readable in the database (no mental division by 1000), and is what Prisma's `Decimal` type is built for — revisit only if a specific downstream integration (e.g. a payment processor) requires minor-unit integers at its boundary, in which case convert at that boundary, not in the schema.
