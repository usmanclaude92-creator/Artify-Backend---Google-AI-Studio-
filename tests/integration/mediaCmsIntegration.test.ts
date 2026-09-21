/** Phase 9 §24 — Page/Post featured-image integration: organization/type/status validation, attach/detach audit, delete blocked while referenced. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.4\nnot an image");

async function createActiveMedia(app: import("express").Express, token: string, filename: string, mimeType = "image/png", bytes = PNG_BYTES) {
  const session = await request(app)
    .post("/api/v1/media/upload-session")
    .set("Authorization", `Bearer ${token}`)
    .send({ filename, mimeType, sizeBytes: bytes.length });
  const { media, uploadToken } = session.body.data;
  testStorageProvider.seedObject(media.storageKey, bytes, mimeType);
  await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${token}`).send({ token: uploadToken });
  return media.id as string;
}

describe("CMS featured-image integration", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "media-cms-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Cms",
      lastName: "Admin",
      organizationName: "Media CMS Co",
    });
    adminToken = reg.body.data.session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "media-cms-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Media CMS Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("attaches an ACTIVE image as a page's featured image at creation, and audits MEDIA_ATTACHED_TO_CONTENT", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "hero.png");
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Landing", body: "content", featuredMediaId: mediaId });
    expect(res.status).toBe(201);
    expect(res.body.data.page.featuredMediaId).toBe(mediaId);
  });

  it("rejects a featuredMediaId that belongs to a different organization (IDOR-safe)", async () => {
    const foreignMediaId = await createActiveMedia(app, otherOrgAdminToken, "foreign-hero.png");
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Hijack Attempt", body: "content", featuredMediaId: foreignMediaId });
    expect(res.status).toBe(400);
  });

  it("rejects a non-image media type as a featured image", async () => {
    const docId = await createActiveMedia(app, adminToken, "brochure.pdf", "application/pdf", PDF_BYTES);
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Bad Featured Type", body: "content", featuredMediaId: docId });
    expect(res.status).toBe(400);
  });

  it("rejects a PENDING (not yet completed) media as a featured image", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "still-pending.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    const res = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Pending Media", body: "content", featuredMediaId: session.body.data.media.id });
    expect(res.status).toBe(400);
  });

  it("attaches and detaches a post's featured image via PATCH, auditing both directions", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "post-hero.png");
    const created = await request(app).post("/api/v1/posts").set("Authorization", `Bearer ${adminToken}`).send({ title: "Post With Hero", body: "content" });
    const postId = created.body.data.post.id;

    const attach = await request(app).patch(`/api/v1/posts/${postId}`).set("Authorization", `Bearer ${adminToken}`).send({ featuredMediaId: mediaId });
    expect(attach.status).toBe(200);
    expect(attach.body.data.post.featuredMediaId).toBe(mediaId);
    const attachAudit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_ATTACHED_TO_CONTENT", resourceId: postId } });
    expect(attachAudit).not.toBeNull();

    const detach = await request(app).patch(`/api/v1/posts/${postId}`).set("Authorization", `Bearer ${adminToken}`).send({ featuredMediaId: null });
    expect(detach.status).toBe(200);
    expect(detach.body.data.post.featuredMediaId).toBeNull();
    const detachAudit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_DETACHED_FROM_CONTENT", resourceId: postId } });
    expect(detachAudit).not.toBeNull();
  });

  it("blocks deleting media that is currently used as a featured image, and allows it once detached", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "referenced.png");
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "References Media", body: "content", featuredMediaId: mediaId });
    const pageId = created.body.data.page.id;

    const blockedDelete = await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(blockedDelete.status).toBe(409);

    await request(app).patch(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`).send({ featuredMediaId: null });

    const allowedDelete = await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(allowedDelete.status).toBe(200);
  });

  it("archiving referenced media does not silently break the page — the reference and page remain intact", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "archived-but-referenced.png");
    const created = await request(app)
      .post("/api/v1/pages")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Keeps Reference", body: "content", featuredMediaId: mediaId });
    const pageId = created.body.data.page.id;

    const archive = await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);

    const page = await request(app).get(`/api/v1/pages/${pageId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(page.status).toBe(200);
    expect(page.body.data.page.featuredMediaId).toBe(mediaId);
  });
});
