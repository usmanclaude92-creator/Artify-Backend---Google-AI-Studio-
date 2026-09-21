/** Phase 9 — media upload session, completion (with server-side verification), list/get/update/archive/delete, signed read URL. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.4\n%rest of a real pdf");

async function createAndComplete(app: import("express").Express, token: string, opts: { filename?: string; mimeType?: string; bytes?: Buffer } = {}) {
  const filename = opts.filename ?? "photo.png";
  const mimeType = opts.mimeType ?? "image/png";
  const bytes = opts.bytes ?? PNG_BYTES;
  const session = await request(app)
    .post("/api/v1/media/upload-session")
    .set("Authorization", `Bearer ${token}`)
    .send({ filename, mimeType, sizeBytes: bytes.length });
  const { media, uploadToken } = session.body.data;
  testStorageProvider.seedObject(media.storageKey, bytes, mimeType);
  const complete = await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${token}`).send({ token: uploadToken });
  return { session, complete, mediaId: media.id as string };
}

describe("Media Library", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "media-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Media",
      lastName: "Admin",
      organizationName: "Media Admin Co",
    });
    adminToken = reg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates an upload session with a server-generated, organization-partitioned storage key, and audits MEDIA_UPLOAD_INITIATED", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "photo.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    expect(res.status).toBe(201);
    expect(res.body.data.media.status).toBe("PENDING");
    expect(res.body.data.media.storageKey).toMatch(/^organizations\/.+\/media\/.+\/photo\.png$/);
    expect(res.body.data.upload.url).toBeTruthy();
    expect(res.body.data.uploadToken).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_UPLOAD_INITIATED", resourceId: res.body.data.media.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a MIME type outside the allowlist", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "run.exe", mimeType: "application/x-msdownload", sizeBytes: 1000 });
    expect(res.status).toBe(400);
  });

  it("rejects a filename whose extension does not match the declared MIME type", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "photo.png", mimeType: "image/jpeg", sizeBytes: 1000 });
    expect(res.status).toBe(400);
  });

  it("rejects a file exceeding the configured size limit for its category", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "huge.png", mimeType: "image/png", sizeBytes: 999_000_000 });
    expect(res.status).toBe(400);
  });

  it("completes an upload after independently verifying the object exists and its magic bytes match, marking it ACTIVE", async () => {
    const { complete, mediaId } = await createAndComplete(app, adminToken);
    expect(complete.status).toBe(200);
    expect(complete.body.data.media.status).toBe("ACTIVE");

    const audit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_UPLOAD_COMPLETED", resourceId: mediaId } });
    expect(audit).not.toBeNull();
  });

  it("never trusts the client's claim alone — completing when no object was actually uploaded fails and marks the media FAILED", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "ghost.png", mimeType: "image/png", sizeBytes: 100 });
    const { media, uploadToken } = session.body.data;
    // Deliberately never seed the object — simulates an abandoned upload.
    const complete = await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken });
    expect(complete.status).toBe(409);

    const row = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    expect(row?.status).toBe("FAILED");
  });

  it("rejects completion when the uploaded bytes don't match the declared MIME type's signature", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "fake.png", mimeType: "image/png", sizeBytes: 20 });
    const { media, uploadToken } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, Buffer.from("not actually a png"), "image/png");
    const complete = await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken });
    expect(complete.status).toBe(400);

    const row = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    expect(row?.status).toBe("FAILED");
  });

  it("rejects completing with the wrong token", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "photo2.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    const { media } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, PNG_BYTES, "image/png");
    const complete = await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: "art_upload_wrongtoken" });
    expect(complete.status).toBe(400);
  });

  it("rejects completing an already-completed session", async () => {
    const { complete: first, mediaId } = await createAndComplete(app, adminToken, { filename: "already.png" });
    expect(first.status).toBe(200);
    const session = await prisma.mediaUploadSession.findUnique({ where: { mediaId } });
    const secondAttempt = await request(app)
      .post(`/api/v1/media/${mediaId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ token: "irrelevant-since-status-check-runs-first" });
    expect(secondAttempt.status).toBe(409);
    expect(session?.completedAt).not.toBeNull();
  });

  it("rejects completing an expired upload session", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "expired.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.length });
    const { media, uploadToken } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, PDF_BYTES, "application/pdf");
    await prisma.mediaUploadSession.update({ where: { mediaId: media.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const complete = await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken });
    expect(complete.status).toBe(409);

    const row = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    expect(row?.status).toBe("FAILED");
  });

  it("lists, searches, filters by status/mimeType, and paginates media server-side", async () => {
    await createAndComplete(app, adminToken, { filename: "findable-alpha.png" });
    await createAndComplete(app, adminToken, { filename: "findable-beta.pdf", mimeType: "application/pdf", bytes: PDF_BYTES });

    const search = await request(app).get("/api/v1/media").query({ search: "findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.media.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app).get("/api/v1/media").query({ mimeType: "application/pdf" }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.body.data.media.every((m: { mimeType: string }) => m.mimeType === "application/pdf")).toBe(true);

    const paged = await request(app).get("/api/v1/media").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.media).toHaveLength(1);

    const unsafeSort = await request(app).get("/api/v1/media").query({ sort: "1; DROP TABLE media_assets;--" }).set("Authorization", `Bearer ${adminToken}`);
    expect(unsafeSort.status).toBe(400);
  });

  it("issues a signed read URL for ACTIVE media only, and audits MEDIA_SIGNED_URL_ISSUED without leaking the URL itself", async () => {
    const { mediaId } = await createAndComplete(app, adminToken, { filename: "readable.png" });
    const res = await request(app).get(`/api/v1/media/${mediaId}/url`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_SIGNED_URL_ISSUED", resourceId: mediaId } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterData ?? {})).not.toContain(res.body.data.url);

    const pendingSession = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "still-pending.png", mimeType: "image/png", sizeBytes: 10 });
    const pendingUrl = await request(app).get(`/api/v1/media/${pendingSession.body.data.media.id}/url`).set("Authorization", `Bearer ${adminToken}`);
    expect(pendingUrl.status).toBe(409);
  });

  it("updates media metadata (displayName/altText/caption/visibility) and audits MEDIA_METADATA_UPDATED", async () => {
    const { mediaId } = await createAndComplete(app, adminToken, { filename: "editable.png" });
    const res = await request(app)
      .patch(`/api/v1/media/${mediaId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ displayName: "A nice photo", altText: "alt text", visibility: "PUBLIC" });
    expect(res.status).toBe(200);
    expect(res.body.data.media.displayName).toBe("A nice photo");
    expect(res.body.data.media.visibility).toBe("PUBLIC");

    const audit = await prisma.auditLog.findFirst({ where: { action: "MEDIA_METADATA_UPDATED", resourceId: mediaId } });
    expect(audit).not.toBeNull();
  });

  it("archives media via the dedicated endpoint, rejecting a second archive", async () => {
    const { mediaId } = await createAndComplete(app, adminToken, { filename: "archivable.png" });
    const archive = await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.media.status).toBe("ARCHIVED");

    const reArchive = await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reArchive.status).toBe(409);
  });

  it("soft-deletes media (never a physical delete) and excludes it from listing/get thereafter", async () => {
    const { mediaId } = await createAndComplete(app, adminToken, { filename: "deletable.png" });
    const del = await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(del.status).toBe(200);

    const row = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();

    const get = await request(app).get(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/media")).status).toBe(401);
  });
});
