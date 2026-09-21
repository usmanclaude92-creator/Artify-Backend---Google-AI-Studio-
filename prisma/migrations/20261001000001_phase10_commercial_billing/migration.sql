-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'CHEQUE', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- BillingCycle.ONE_TIME/QUARTERLY, ContractStatus.SUSPENDED, and
-- SubscriptionStatus.DRAFT/PAUSED were added by the preceding migration
-- (20261001000000_phase10_enum_values) — see that file's comment for why
-- they had to be split out and committed first.

-- AlterEnum
-- InvoiceStatus.SENT is renamed to ISSUED (the exact word the rest of
-- this phase's workflow/endpoints use). A straight text-cast USING clause
-- would fail on any pre-existing row whose status is still 'SENT' (that
-- value no longer exists in the new enum) — the CASE below explicitly
-- remaps it, so this migration is safe to run against a non-empty
-- `invoices` table, not just an empty one.
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'CANCELLED');
ALTER TABLE "public"."invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING (
  (CASE "status"::text WHEN 'SENT' THEN 'ISSUED' ELSE "status"::text END)::"InvoiceStatus_new"
);
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "public"."InvoiceStatus_old";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
-- `title` is new-NOT-NULL — safe nullable-then-backfill-then-lock pattern
-- (established Phase 5-7 convention) rather than a bare NOT NULL add,
-- since a real deployment's `contracts` table is not guaranteed empty.
-- Pre-Phase-10 rows get a placeholder derived from their contract number;
-- there is no other title data to recover it from.
ALTER TABLE "contracts" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "title" TEXT;
UPDATE "contracts" SET "title" = 'Contract ' || "contract_number" WHERE "title" IS NULL;
ALTER TABLE "contracts" ALTER COLUMN "title" SET NOT NULL;

-- AlterTable
-- `line_total` replaces `amount` (same meaning, clearer name) — backfilled
-- from the outgoing `amount` column before it's dropped, so no existing
-- invoice line loses its recorded total.
ALTER TABLE "invoice_items" ADD COLUMN     "discount" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN     "line_total" DECIMAL(18,3),
ADD COLUMN     "product_module_id" TEXT;
UPDATE "invoice_items" SET "line_total" = "amount" WHERE "line_total" IS NULL;
ALTER TABLE "invoice_items" ALTER COLUMN "line_total" SET NOT NULL;
ALTER TABLE "invoice_items" DROP COLUMN "amount";

-- AlterTable
-- `amount_due` is new-NOT-NULL — backfilled to `total` (amount_paid
-- defaults to 0, so amount_due = total - 0 for every pre-existing
-- invoice, which is exactly correct: no Payment rows could have existed
-- before this migration, since the `payments` table didn't exist yet).
ALTER TABLE "invoices" ADD COLUMN     "amount_due" DECIMAL(18,3),
ADD COLUMN     "amount_paid" DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "void_reason" TEXT;
UPDATE "invoices" SET "amount_due" = "total" WHERE "amount_due" IS NULL;
ALTER TABLE "invoices" ALTER COLUMN "amount_due" SET NOT NULL;

-- AlterTable
-- `subscription_number` is new-NOT-NULL — backfilled with a clearly-marked
-- legacy placeholder for any pre-Phase-10 row (there is no prior numbering
-- scheme to recover a real number from; every environment verified to
-- have 0 existing subscription rows, but this stays safe even if that
-- ever isn't true).
ALTER TABLE "subscriptions" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" TEXT,
ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "renewal_date" DATE,
ADD COLUMN     "subscription_number" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';
UPDATE "subscriptions" SET "subscription_number" = 'SUB-LEGACY-' || "id" WHERE "subscription_number" IS NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "subscription_number" SET NOT NULL;

-- CreateTable
CREATE TABLE "contract_variations" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "variation_number" INTEGER NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_variations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payment_date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "notes" TEXT,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_variations_contract_id_variation_number_key" ON "contract_variations"("contract_id", "variation_number");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_idx" ON "payments"("organization_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subscription_number_key" ON "subscriptions"("subscription_number");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_module_id_fkey" FOREIGN KEY ("product_module_id") REFERENCES "product_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-added: race-safe, production-safe document numbering (§12).
-- Postgres SEQUENCEs are atomic and gap-tolerant (a rolled-back
-- transaction leaves a gap, never a duplicate or a blocking lock) —
-- the standard, correct primitive for "unique, server-generated,
-- never-duplicated, concurrency-safe" business document numbers.
-- Queried via `nextval()` in contractService/subscriptionService/
-- billingService, never generated from a timestamp or trusted from
-- the client.
CREATE SEQUENCE IF NOT EXISTS "contract_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "subscription_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" START 1;

-- Hand-added CHECK constraints (§49) — not expressible in the stable
-- Prisma schema DSL, same convention as Phase 2's original set above.
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_variation_number_positive" CHECK ("variation_number" > 0);
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_amount_nonzero" CHECK ("amount" <> 0);

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_line_total_non_negative" CHECK ("line_total" >= 0);
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_discount_non_negative" CHECK ("discount" >= 0);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_paid_non_negative" CHECK ("amount_paid" >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_due_non_negative" CHECK ("amount_due" >= 0);

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- A REVERSED payment must always carry its reversal metadata together
-- (never a status flip with no audit trail of who/when/why), and a
-- non-reversed payment must never carry stray reversal metadata.
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_fields_consistent" CHECK (
  ("status" = 'REVERSED' AND "reversed_at" IS NOT NULL AND "reversal_reason" IS NOT NULL)
  OR ("status" <> 'REVERSED' AND "reversed_at" IS NULL AND "reversed_by" IS NULL AND "reversal_reason" IS NULL)
);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_renewal_date_after_start" CHECK ("renewal_date" IS NULL OR "renewal_date" >= "start_date");
