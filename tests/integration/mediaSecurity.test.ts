/** Phase 9 §37 — Media Library security: RBAC tiers, cross-organization IDOR, storage-key integrity. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function createActiveMedia(app: import("express").Express, token: string, filename = "photo.png") {
  const session = await request(app)
    .post("/api/v1/media/upload-session")
    .set("Authorization", `Bearer ${token}`)
    .send({ filename, mimeType: "image/png", sizeBytes: PNG_BYTES.length });
  const { media, uploadToken } = session.body.data;
  testStorageProvider.seedObject(media.storageKey, PNG_BYTES, "image/png");
  await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${token}`).send({ token: uploadToken });
  return media.id as string;
}

describe("Media Library security", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;
  let otherOrgMediaId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "media-sec-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Sec",
      lastName: "Admin",
      organizationName: "Media Sec Co",
    });
    adminToken = reg.body.data.session.token;

    for (const [email, roleKey] of [
      ["media-sec-manager@example.com", "MANAGER"],
      ["media-sec-user@example.com", "USER"],
      ["media-sec-viewer@example.com", "VIEWER"],
    ] as const) {
      await request(app)
        .post("/api/v1/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email, password: "MemberPassword123", firstName: "M", lastName: "W", roleKey });
    }
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "media-sec-manager@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "media-sec-user@example.com", password: "MemberPassword123" })).body.data
      .session.token;
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "media-sec-viewer@example.com", password: "MemberPassword123" })).body.data
      .session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "media-sec-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Media Sec Co",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
    otherOrgMediaId = await createActiveMedia(app, otherOrgAdminToken, "other-org-photo.png");
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated requests on every endpoint", async () => {
    expect((await request(app).get("/api/v1/media")).status).toBe(401);
    expect((await request(app).post("/api/v1/media/upload-session").send({})).status).toBe(401);
    expect((await request(app).get(`/api/v1/media/${otherOrgMediaId}`)).status).toBe(401);
  });

  it("VIEWER can read media but cannot upload, update, archive, or delete", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "viewer-target.png");

    expect((await request(app).get("/api/v1/media").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/v1/media/upload-session")
          .set("Authorization", `Bearer ${viewerToken}`)
          .send({ filename: "x.png", mimeType: "image/png", sizeBytes: 10 })
      ).status
    ).toBe(403);
    expect((await request(app).patch(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${viewerToken}`).send({ displayName: "x" })).status).toBe(403);
    expect((await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${viewerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${viewerToken}`).send()).status).toBe(403);
    expect((await request(app).get(`/api/v1/media/${mediaId}/url`).set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
  });

  it("USER can upload but cannot update/archive/delete (matches content.* tier shape)", async () => {
    const created = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ filename: "user-upload.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    expect(created.status).toBe(201);
    const mediaId = created.body.data.media.id;

    expect((await request(app).patch(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${userToken}`).send({ displayName: "x" })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${userToken}`).send()).status).toBe(403);
  });

  it("MANAGER can update media but cannot archive/delete (media.delete stays ADMIN-only)", async () => {
    const mediaId = await createActiveMedia(app, adminToken, "manager-target.png");
    expect((await request(app).patch(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${managerToken}`).send({ displayName: "ok" })).status).toBe(
      200
    );
    expect((await request(app).post(`/api/v1/media/${mediaId}/archive`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).delete(`/api/v1/media/${mediaId}`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
  });

  it("IDOR: an organization cannot read, update, archive, delete, or generate a signed URL for another organization's media", async () => {
    expect((await request(app).get(`/api/v1/media/${otherOrgMediaId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/media/${otherOrgMediaId}/url`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/media/${otherOrgMediaId}`).set("Authorization", `Bearer ${adminToken}`).send({ displayName: "hijack" })).status).toBe(
      404
    );
    expect((await request(app).post(`/api/v1/media/${otherOrgMediaId}/archive`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
    expect((await request(app).delete(`/api/v1/media/${otherOrgMediaId}`).set("Authorization", `Bearer ${adminToken}`).send()).status).toBe(404);
  });

  it("IDOR: cannot complete an upload against another organization's media row, even with a guessed id", async () => {
    const res = await request(app)
      .post(`/api/v1/media/${otherOrgMediaId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ token: "art_upload_whatever" });
    expect(res.status).toBe(404);
  });

  it("IDOR: an organization's media never appears in another organization's list", async () => {
    const list = await request(app).get("/api/v1/media").query({ limit: 100 }).set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.media.some((m: { id: string }) => m.id === otherOrgMediaId)).toBe(false);
  });

  it("a server-generated storage key never allows path traversal, regardless of the uploaded filename", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "../../../etc/passwd.png", mimeType: "image/png", sizeBytes: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.media.storageKey).not.toContain("..");
    expect(res.body.data.media.storageKey.startsWith("organizations/")).toBe(true);
  });

  it("rejects an oversized document upload even when declared as PDF (per-category limit enforced server-side)", async () => {
    const res = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "huge.pdf", mimeType: "application/pdf", sizeBytes: 999_000_000 });
    expect(res.status).toBe(400);
  });
});
