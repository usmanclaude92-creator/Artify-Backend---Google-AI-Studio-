-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE');

-- AlterEnum
BEGIN;
CREATE TYPE "ProductModuleStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
ALTER TABLE "public"."product_modules" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "product_modules" ALTER COLUMN "status" TYPE "ProductModuleStatus_new" USING ("status"::text::"ProductModuleStatus_new");
ALTER TYPE "ProductModuleStatus" RENAME TO "ProductModuleStatus_old";
ALTER TYPE "ProductModuleStatus_new" RENAME TO "ProductModuleStatus";
DROP TYPE "public"."ProductModuleStatus_old";
ALTER TABLE "product_modules" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ProductStatus_new" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
ALTER TABLE "public"."products" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "status" TYPE "ProductStatus_new" USING ("status"::text::"ProductStatus_new");
ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_old";
ALTER TYPE "ProductStatus_new" RENAME TO "ProductStatus";
DROP TYPE "public"."ProductStatus_old";
ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
-- slug is added nullable first, then backfilled and locked to NOT NULL
-- below — hand-edited from the plain `prisma migrate diff` output (which
-- emits a bare NOT NULL with no default) to stay safe if this table is
-- ever non-empty by the time this runs, per the established Phase 5/6
-- migration-safety convention. Verified 0 existing rows in artify_dev and
-- artify_test at the time this migration was written.
ALTER TABLE "product_modules" ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_core" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slug" TEXT;

UPDATE "product_modules" SET "slug" = lower(regexp_replace(regexp_replace("code", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) WHERE "slug" IS NULL;

ALTER TABLE "product_modules" ALTER COLUMN "slug" SET NOT NULL;

-- AlterTable
-- Same safe nullable-then-backfill pattern for slug and type (type has no
-- sensible default to infer from existing data, so it backfills to
-- 'PRODUCT' — a no-op today since the table is empty; an operator must
-- explicitly review any pre-existing row's real type after this runs).
ALTER TABLE "products" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "short_description" TEXT,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "type" "ProductType",
ADD COLUMN     "updated_by" TEXT;

UPDATE "products" SET "slug" = lower(regexp_replace(regexp_replace("code", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) WHERE "slug" IS NULL;
UPDATE "products" SET "type" = 'PRODUCT' WHERE "type" IS NULL;

ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "product_modules_status_idx" ON "product_modules"("status");

-- CreateIndex
CREATE INDEX "product_modules_display_order_idx" ON "product_modules"("display_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_modules_product_id_slug_key" ON "product_modules"("product_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "products_display_order_idx" ON "products"("display_order");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

