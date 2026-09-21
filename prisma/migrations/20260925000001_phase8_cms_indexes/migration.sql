-- CreateIndex
CREATE INDEX "pages_organization_id_status_idx" ON "pages"("organization_id", "status");

-- CreateIndex
CREATE INDEX "post_tags_tag_id_idx" ON "post_tags"("tag_id");

-- CreateIndex
CREATE INDEX "posts_organization_id_status_idx" ON "posts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "posts_category_id_idx" ON "posts"("category_id");

-- CreateIndex
CREATE INDEX "posts_author_id_idx" ON "posts"("author_id");
