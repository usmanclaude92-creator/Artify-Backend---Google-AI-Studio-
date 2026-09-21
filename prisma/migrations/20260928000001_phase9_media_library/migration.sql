-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterEnum
BEGIN;
CREATE TYPE "MediaStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'ARCHIVED');
ALTER TABLE "public"."media_assets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "media_assets" ALTER COLUMN "status" TYPE "MediaStatus_new" USING ("status"::text::"MediaStatus_new");
ALTER TYPE "MediaStatus" RENAME TO "MediaStatus_old";
ALTER TYPE "MediaStatus_new" RENAME TO "MediaStatus";
DROP TYPE "public"."MediaStatus_old";
ALTER TABLE "media_assets" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropIndex
DROP INDEX "media_assets_organization_id_idx";

-- AlterTable
ALTER TABLE "media_assets" DROP COLUMN "filename",
ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "display_name" TEXT,
ADD COLUMN     "duration_seconds" INTEGER,
ADD COLUMN     "original_filename" TEXT NOT NULL,
ADD COLUMN     "storage_bucket" TEXT NOT NULL,
ADD COLUMN     "storage_provider" TEXT NOT NULL,
ADD COLUMN     "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "featured_media_id" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "featured_media_id" TEXT;

-- CreateTable
CREATE TABLE "media_upload_sessions" (
    "id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "storage_key" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_upload_sessions_media_id_key" ON "media_upload_sessions"("media_id");

-- CreateIndex
CREATE INDEX "media_upload_sessions_organization_id_idx" ON "media_upload_sessions"("organization_id");

-- CreateIndex
CREATE INDEX "media_assets_organization_id_status_idx" ON "media_assets"("organization_id", "status");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_featured_media_id_fkey" FOREIGN KEY ("featured_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_featured_media_id_fkey" FOREIGN KEY ("featured_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

