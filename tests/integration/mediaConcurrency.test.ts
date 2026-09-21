/** Phase 9 §38 — concurrent completion/archive/delete on media must be idempotent-safe, never double-apply. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { testStorageProvider } from "../../server/storage/testStorageProvider";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("Media Library concurrency", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "media-conc-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Conc",
      lastName: "Admin",
      organizationName: "Media Concurrency Co",
    });
    adminToken = reg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("concurrent completion attempts on the same upload session succeed exactly once", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "race.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    const { media, uploadToken } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, PNG_BYTES, "image/png");

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken }),
      request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const row = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    expect(row?.status).toBe("ACTIVE");
  });

  it("concurrent archive attempts on the same media succeed exactly once", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "archive-race.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    const { media, uploadToken } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, PNG_BYTES, "image/png");
    await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken });

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/media/${media.id}/archive`).set("Authorization", `Bearer ${adminToken}`).send(),
      request(app).post(`/api/v1/media/${media.id}/archive`).set("Authorization", `Bearer ${adminToken}`).send(),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("concurrent metadata updates both apply without error (last write wins — no destructive interleave)", async () => {
    const session = await request(app)
      .post("/api/v1/media/upload-session")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ filename: "update-race.png", mimeType: "image/png", sizeBytes: PNG_BYTES.length });
    const { media, uploadToken } = session.body.data;
    testStorageProvider.seedObject(media.storageKey, PNG_BYTES, "image/png");
    await request(app).post(`/api/v1/media/${media.id}/complete`).set("Authorization", `Bearer ${adminToken}`).send({ token: uploadToken });

    const [first, second] = await Promise.all([
      request(app).patch(`/api/v1/media/${media.id}`).set("Authorization", `Bearer ${adminToken}`).send({ displayName: "Name A" }),
      request(app).patch(`/api/v1/media/${media.id}`).set("Authorization", `Bearer ${adminToken}`).send({ displayName: "Name B" }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const row = await prisma.mediaAsset.findUnique({ where: { id: media.id } });
    expect(["Name A", "Name B"]).toContain(row?.displayName);
  });
});
