/** Phase 8 — post CRUD, category/tag assignment, publish workflow, IDOR, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CMS posts", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let categoryId: string;
  let tagAId: string;
  let tagBId: string;
  let otherOrgCategoryId: string;
  let otherOrgTagId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "posts-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Posts",
      lastName: "Admin",
      organizationName: "Posts Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "posts-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "posts-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "posts-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Posts Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;

    const cat = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${adminToken}`).send({ name: "News" });
    categoryId = cat.body.data.category.id;
    const tagA = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "Launch" });
    tagAId = tagA.body.data.tag.id;
    const tagB = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${adminToken}`).send({ name: "Update" });
    tagBId = tagB.body.data.tag.id;

    const otherCat = await request(app).post("/api/v1/categories").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ name: "Foreign Category" });
    otherOrgCategoryId = otherCat.body.data.category.id;
    const otherTag = await request(app).post("/api/v1/tags").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ name: "Foreign Tag" });
    otherOrgTagId = otherTag.body.data.tag.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a post with a category and tags, and audits POST_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Launch Day", body: "content", categoryId, tagIds: [tagAId, tagBId] });
    expect(res.status).toBe(201);
    expect(res.body.data.post.categoryId).toBe(categoryId);
    expect(res.body.data.post.tags).toHaveLength(2);

    const audit = await prisma.auditLog.findFirst({ where: { action: "POST_CREATED", resourceId: res.body.data.post.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a categoryId/tagId that belongs to a different organization (IDOR-safe FK validation)", async () => {
    const badCategory = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Category", categoryId: otherOrgCategoryId });
    expect(badCategory.status).toBe(400);

    const badTag = await request(app)
      .post("/api/v1/posts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Tag", tagIds: [otherOrgTagId] });
    expect(badTag.status).toBe(400);
  });

  it("replaces tag assignment on update", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Retag Me", tagIds: [tagAId] });
    const id = created.body.data.post.id;

    const updated = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ tagIds: [tagBId] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.post.tags).toHaveLength(1);
    expect(updated.body.data.post.tags[0].tag.id).toBe(tagBId);

    const cleared = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ tagIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.post.tags).toHaveLength(0);
  });

  it("publishes a post, blocks direct content edits, and unpublish clones a new revision", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Publish Flow", body: "v1" });
    const id = created.body.data.post.id;

    const publish = await request(app).post(`/api/v1/posts/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.post.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.post.currentRevisionId;

    const editWhilePublished = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "sneaky" });
    expect(editWhilePublished.status).toBe(409);

    const unpublish = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2" });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.post.currentRevision.version).toBe(2);

    const publishedRevision = await prisma.contentRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(publishedRevision?.status).toBe("PUBLISHED");
    expect(publishedRevision?.body).toBe("v1");
  });

  it("submits for review, archives via the dedicated endpoint, and reverts to a prior (published) revision", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Workflow Post", body: "v1" });
    const id = created.body.data.post.id;
    const v1RevisionId = created.body.data.post.currentRevisionId;

    const submit = await request(app).post(`/api/v1/posts/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(submit.status).toBe(200);
    expect(submit.body.data.post.status).toBe("IN_REVIEW");

    // Resubmitting a DRAFT-only workflow step from IN_REVIEW is rejected —
    // move back to DRAFT first (mirrors pages' equivalent rule).
    const resubmit = await request(app).post(`/api/v1/posts/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(resubmit.status).toBe(409);

    const publish = await request(app).post(`/api/v1/posts/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);

    // v1 is now published (immutable); unpublishing + editing clones v2.
    const unpublishAndEdit = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2" });
    expect(unpublishAndEdit.status).toBe(200);
    expect(unpublishAndEdit.body.data.post.currentRevision.version).toBe(2);

    const archive = await request(app).post(`/api/v1/posts/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.post.status).toBe("ARCHIVED");

    const revertWhileArchived = await request(app)
      .post(`/api/v1/posts/${id}/revert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ revisionId: v1RevisionId });
    expect(revertWhileArchived.status).toBe(409);

    const restore = await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT" });
    expect(restore.status).toBe(200);

    const revert = await request(app).post(`/api/v1/posts/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.post.currentRevision.body).toBe("v1");
    expect(revert.body.data.post.currentRevision.version).toBe(3);

    const v1Untouched = await prisma.contentRevision.findUnique({ where: { id: v1RevisionId } });
    expect(v1Untouched?.status).toBe("PUBLISHED");
    expect(v1Untouched?.body).toBe("v1");

    const audit = await prisma.auditLog.findFirst({ where: { action: "POST_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("rejects setting ARCHIVED directly via generic PATCH (dedicated endpoint only)", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Direct Archive Attempt" });
    const res = await request(app).patch(`/api/v1/posts/${created.body.data.post.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
    expect(res.status).toBe(400);
  });

  it("optimistic concurrency: a stale expectedUpdatedAt is rejected with 409", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Concurrent Post", body: "v1" });
    const id = created.body.data.post.id;
    const staleUpdatedAt = created.body.data.post.updatedAt;

    await request(app).patch(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "other change" });

    const stale = await request(app)
      .patch(`/api/v1/posts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "stale change", expectedUpdatedAt: staleUpdatedAt });
    expect(stale.status).toBe(409);
  });

  it("soft-deletes a post and excludes it from listing/get thereafter", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Delete Me" });
    const id = created.body.data.post.id;

    const del = await request(app).delete(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);

    const row = await prisma.post.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();

    const get = await request(app).get(`/api/v1/posts/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  it("filters by categoryId and tagId server-side", async () => {
    const filtered = await request(app).get("/api/v1/posts").query({ categoryId }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.posts.every((p: { categoryId: string }) => p.categoryId === categoryId)).toBe(true);

    const byTag = await request(app).get("/api/v1/posts").query({ tagId: tagAId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byTag.status).toBe(200);
  });

  it("enforces permissions and rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/posts").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${viewerToken}`).send({ title: "X" })).status).toBe(403);
    expect((await request(app).get("/api/v1/posts")).status).toBe(401);
  });

  it("IDOR: a post id from another organization is not readable, editable, or deletable", async () => {
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ title: "Other Org Post" });
    const foreignId = created.body.data.post.id;

    expect((await request(app).get(`/api/v1/posts/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/posts/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Hijack" })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/posts/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });
});
