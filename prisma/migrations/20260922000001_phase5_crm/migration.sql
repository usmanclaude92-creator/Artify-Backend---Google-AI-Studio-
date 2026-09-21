-- Phase 5 — CRM & Client Management
-- Client: adds name/legal_name/email/phone/website/address (real display
-- identity — Phase 2's Client had none), widens ClientStatus to
-- PROSPECT/ACTIVE/INACTIVE/SUSPENDED/ARCHIVED (was ACTIVE/INACTIVE/CHURNED;
-- safe — verified zero existing client rows in every environment this
-- migration was built/tested against, see docs/PHASE_5_IMPLEMENTATION.md).
-- Lead: adds converted_client_id/converted_at (conversion audit trail).
-- Contact: adds is_primary + a partial unique index enforcing at most one
-- primary contact per client. No destructive drop of data-bearing columns.
-- See docs/CRM_ARCHITECTURE.md.

-- AlterEnum
BEGIN;
CREATE TYPE "ClientStatus_new" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');
ALTER TABLE "public"."clients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "clients" ALTER COLUMN "status" TYPE "ClientStatus_new" USING ("status"::text::"ClientStatus_new");
ALTER TYPE "ClientStatus" RENAME TO "ClientStatus_old";
ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";
DROP TYPE "public"."ClientStatus_old";
ALTER TABLE "clients" ALTER COLUMN "status" SET DEFAULT 'PROSPECT';
COMMIT;

-- AlterTable
-- Phase 5 — Client gained a real name field (Phase 2's Client had none;
-- clientCode is an internal reference, not a display name). Added
-- nullable first and backfilled from client_code so this migration is
-- safe to run against a target that already has client rows (none exist
-- in any environment this was built/tested against, but the migration
-- must not assume that), then made NOT NULL — never a bare
-- `ADD COLUMN ... NOT NULL` with no default against a populated table.
ALTER TABLE "clients" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "legal_name" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "website" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PROSPECT';

UPDATE "clients" SET "name" = "client_code" WHERE "name" IS NULL;

ALTER TABLE "clients" ALTER COLUMN "name" SET NOT NULL;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false;

-- At most one primary contact per client (Phase 5 §13/§26). A plain
-- UNIQUE(client_id, is_primary) can't express "only when true" — Postgres
-- treats every row as satisfying uniqueness independently unless
-- constrained by a partial index, which Prisma's schema DSL has no syntax
-- for (same pattern as Phase 2's hand-added CHECK constraints).
CREATE UNIQUE INDEX "contacts_one_primary_per_client"
  ON "contacts"("client_id")
  WHERE "is_primary" = true AND "client_id" IS NOT NULL AND "deleted_at" IS NULL;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "converted_at" TIMESTAMP(3),
ADD COLUMN     "converted_client_id" TEXT;

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_created_at_idx" ON "clients"("created_at");

-- CreateIndex
CREATE INDEX "leads_assigned_to_idx" ON "leads"("assigned_to");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_fkey" FOREIGN KEY ("converted_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

