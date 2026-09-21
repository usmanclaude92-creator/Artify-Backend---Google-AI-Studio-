/** Phase 8 — page CRUD, publish/schedule workflow, revision immutability, permissions, IDOR, concurrency. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CMS pages", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "pages-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Pages",
      lastName: "Admin",
      organizationName: "Pages Admin Co",
    });
    adminToken = reg.body.data.session.token;

    for (const [email, roleKey] of [
      ["pages-manager@example.com", "MANAGER"],
      ["pages-user@example.com", "USER"],
      ["pages-viewer@example.com", "VIEWER"],
    ] as const) {
      await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: "MemberPassword123", firstName: "M", lastName: "W", roleKey });
    }
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-manager@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-user@example.com", password: "MemberPassword123" })).body.data.session
      .token;
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pages-viewer@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "pages-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Org Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a page with a server-generated slug, a v1 DRAFT revision, and audits PAGE_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "About Us", body: "<p>Hello</p>" });
    expect(res.status).toBe(201);
    expect(res.body.data.page.slug).toBe("about-us");
    expect(res.body.data.page.status).toBe("DRAFT");
    expect(res.body.data.page.currentRevision.version).toBe(1);
    expect(res.body.data.page.currentRevision.status).toBe("DRAFT");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_CREATED", resourceId: res.body.data.page.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate explicit slug within the same organization with a clean 409", async () => {
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Dup A", slug: "dup-slug" });
    const dupe = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Dup B", slug: "dup-slug" });
    expect(dupe.status).toBe(409);
  });

  it("edits DRAFT content in place (no new revision) until publish, then clones on further edits", async () => {
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Lifecycle Page", body: "v1 body" });
    const id = created.body.data.page.id;

    const edited = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v1 body edited" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.page.currentRevision.version).toBe(1);
    expect(edited.body.data.page.currentRevision.body).toBe("v1 body edited");

    const publish = await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);
    expect(publish.body.data.page.status).toBe("PUBLISHED");
    expect(publish.body.data.page.currentRevision.status).toBe("PUBLISHED");
    const publishedRevisionId = publish.body.data.page.currentRevisionId;

    // Editing a PUBLISHED page's content directly is rejected — must unpublish first (§ mutate-vs-clone rule).
    const editWhilePublished = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "sneaky" });
    expect(editWhilePublished.status).toBe(409);

    // Unpublish (PUBLISHED -> DRAFT) clones a new revision, leaving the published one untouched.
    const unpublish = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2 body" });
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.page.status).toBe("DRAFT");
    expect(unpublish.body.data.page.currentRevision.version).toBe(2);
    expect(unpublish.body.data.page.currentRevision.body).toBe("v2 body");

    const publishedRevision = await prisma.contentRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(publishedRevision?.status).toBe("PUBLISHED");
    expect(publishedRevision?.body).toBe("v1 body edited");

    const revisions = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisions.body.data.revisions).toHaveLength(2);
  });

  it("rejects an invalid direct status transition (DRAFT -> PUBLISHED via generic PATCH)", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Bad Transition" });
    const id = created.body.data.page.id;
    const res = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "PUBLISHED" });
    expect(res.status).toBe(400);
  });

  it("schedules a page for the future, then rejects scheduling an already-published page", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Scheduled Page", body: "content" });
    const id = created.body.data.page.id;

    const future = new Date(Date.now() + 86400000).toISOString();
    const schedule = await request(app).post(`/api/v1/pages/${id}/schedule`).set("Authorization", `Bearer ${adminToken}`).send({ scheduledAt: future });
    expect(schedule.status).toBe(200);
    expect(schedule.body.data.page.status).toBe("SCHEDULED");

    const pastReject = await request(app)
      .post(`/api/v1/pages/${id}/schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ scheduledAt: new Date(Date.now() - 1000).toISOString() });
    expect(pastReject.status).toBe(400);

    const publish = await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(publish.status).toBe(200);

    const rescheduleAfterPublish = await request(app)
      .post(`/api/v1/pages/${id}/schedule`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ scheduledAt: future });
    expect(rescheduleAfterPublish.status).toBe(409);
  });

  it("rejects setting ARCHIVED/IN_REVIEW directly via generic PATCH (dedicated endpoints only)", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Direct Status Attempt" });
    const id = created.body.data.page.id;
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "IN_REVIEW" })).status).toBe(400);
  });

  it("archives via the dedicated endpoint, blocks further content edits, and restore (PATCH -> DRAFT) re-enables editing", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Archive Me" });
    const id = created.body.data.page.id;

    const archive = await request(app).post(`/api/v1/pages/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.page.status).toBe("ARCHIVED");

    const reArchive = await request(app).post(`/api/v1/pages/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reArchive.status).toBe(409);

    const editWhileArchived = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Nope" });
    expect(editWhileArchived.status).toBe(409);

    const restore = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT" });
    expect(restore.status).toBe(200);
    expect(restore.body.data.page.status).toBe("DRAFT");

    const editAfterRestore = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Restored Title" });
    expect(editAfterRestore.status).toBe(200);
    expect(editAfterRestore.body.data.page.title).toBe("Restored Title");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_ARCHIVED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("submits a DRAFT page for review, rejecting an empty body and a non-DRAFT source", async () => {
    const empty = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Empty Body Page" });
    const emptyId = empty.body.data.page.id;
    const rejectEmpty = await request(app).post(`/api/v1/pages/${emptyId}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(rejectEmpty.status).toBe(400);

    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Review Me", body: "content" });
    const id = created.body.data.page.id;
    const submit = await request(app).post(`/api/v1/pages/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(submit.status).toBe(200);
    expect(submit.body.data.page.status).toBe("IN_REVIEW");

    const resubmit = await request(app).post(`/api/v1/pages/${id}/submit-review`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(resubmit.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_SUBMITTED_FOR_REVIEW", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("reverts to a prior revision, creating a new revision rather than mutating history, and unpublishes if the page was live", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Revert Me", body: "v1" });
    const id = created.body.data.page.id;
    const v1RevisionId = created.body.data.page.currentRevisionId;

    await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "v1 tweaked" });
    await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${adminToken}`).send();
    await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DRAFT", body: "v2" });

    const revisionsBefore = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisionsBefore.body.data.revisions).toHaveLength(2);

    const revert = await request(app).post(`/api/v1/pages/${id}/revert`).set("Authorization", `Bearer ${adminToken}`).send({ revisionId: v1RevisionId });
    expect(revert.status).toBe(200);
    expect(revert.body.data.page.currentRevision.version).toBe(3);
    expect(revert.body.data.page.currentRevision.body).toBe("v1 tweaked");
    expect(revert.body.data.page.status).toBe("DRAFT");

    const v1Untouched = await prisma.contentRevision.findUnique({ where: { id: v1RevisionId } });
    expect(v1Untouched?.body).toBe("v1 tweaked");
    expect(v1Untouched?.status).toBe("PUBLISHED");

    const revisionsAfter = await request(app).get(`/api/v1/pages/${id}/revisions`).set("Authorization", `Bearer ${adminToken}`);
    expect(revisionsAfter.body.data.revisions).toHaveLength(3);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAGE_REVERTED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("rejects reverting to a revisionId that belongs to a different page (IDOR-safe)", async () => {
    const pageA = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Page A", body: "a" });
    const pageB = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Page B", body: "b" });
    const foreignRevisionId = pageB.body.data.page.currentRevisionId;

    const res = await request(app)
      .post(`/api/v1/pages/${pageA.body.data.page.id}/revert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ revisionId: foreignRevisionId });
    expect(res.status).toBe(404);
  });

  it("optimistic concurrency: a stale expectedUpdatedAt is rejected with 409, never silently overwriting a concurrent edit", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Concurrent Page", body: "v1" });
    const id = created.body.data.page.id;
    const staleUpdatedAt = created.body.data.page.updatedAt;

    const userBUpdate = await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ body: "user B's change" });
    expect(userBUpdate.status).toBe(200);

    const userAStaleUpdate = await request(app)
      .patch(`/api/v1/pages/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "user A's stale change", expectedUpdatedAt: staleUpdatedAt });
    expect(userAStaleUpdate.status).toBe(409);

    const current = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(current.body.data.page.currentRevision.body).toBe("user B's change");

    const freshUpdate = await request(app)
      .patch(`/api/v1/pages/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "user A's fresh change", expectedUpdatedAt: userBUpdate.body.data.page.updatedAt });
    expect(freshUpdate.status).toBe(200);
  });

  it("soft-deletes a page (sets deletedAt, never a physical delete) and excludes it from listing/get thereafter", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Delete Me" });
    const id = created.body.data.page.id;

    const del = await request(app).delete(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);

    const row = await prisma.page.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();

    const get = await request(app).get(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  it("enforces per-permission tiers: VIEWER read-only, USER can create but not update, MANAGER can update but not publish/delete", async () => {
    const created = await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Perm Page" });
    const id = created.body.data.page.id;

    expect((await request(app).get("/api/v1/pages").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${viewerToken}`).send({ title: "X" })).status).toBe(403);

    expect((await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${userToken}`).send({ title: "By User" })).status).toBe(201);
    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${userToken}`).send({ title: "Y" })).status).toBe(403);

    expect((await request(app).patch(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${managerToken}`).send({ title: "By Manager" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/pages/${id}/publish`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/pages/${id}`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/pages");
    expect(res.status).toBe(401);
  });

  it("IDOR: a page id from another organization is not readable, editable, or publishable", async () => {
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ title: "Other Org Page" });
    const foreignId = created.body.data.page.id;

    expect((await request(app).get(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Hijack" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/pages/${foreignId}/publish`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
    expect((await request(app).delete(`/api/v1/pages/${foreignId}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });

  it("searches/filters/paginates/sorts pages server-side", async () => {
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Findable Gamma" });
    await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Findable Delta" });

    const search = await request(app).get("/api/v1/pages").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.pages.length).toBeGreaterThanOrEqual(2);

    const paged = await request(app).get("/api/v1/pages").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.pages).toHaveLength(1);

    const unsafeSort = await request(app).get("/api/v1/pages").query({ sort: "1; DROP TABLE pages;--" }).set("Authorization", `Bearer ${adminToken}`);
    expect(unsafeSort.status).toBe(400);
  });

  it("concurrency: two simultaneous creates with the same explicit slug produce exactly one success and one clean conflict", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Race A", slug: "race-page" }),
      request(app).post("/api/v1/pages").set("Authorization", `Bearer ${adminToken}`).send({ title: "Race B", slug: "race-page" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.page.count({ where: { slug: "race-page" } });
    expect(count).toBe(1);
  });
});
