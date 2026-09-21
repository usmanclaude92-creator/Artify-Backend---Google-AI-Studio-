/** Phase 8 — author profile CRUD, identity-escalation safety, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("CMS authors", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let writerUserId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "authors-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Authors",
      lastName: "Admin",
      organizationName: "Authors Admin Co",
    });
    adminToken = reg.body.data.session.token;

    const viewerReg = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "authors-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "authors-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const writer = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "writer@example.com", password: "WriterPassword123", firstName: "Wanda", lastName: "Writer", roleKey: "USER" });
    writerUserId = writer.body.data.user.id;
    void viewerReg;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates an author profile linked to an existing user, and audits AUTHOR_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/authors")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: writerUserId, bio: "Writes about things." });
    expect(res.status).toBe(201);
    expect(res.body.data.author.userId).toBe(writerUserId);
    expect(res.body.data.author.user.email).toBe("writer@example.com");

    const audit = await prisma.auditLog.findFirst({ where: { action: "AUTHOR_CREATED", resourceId: res.body.data.author.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects creating a second author profile for the same user", async () => {
    const dupe = await request(app).post("/api/v1/authors").set("Authorization", `Bearer ${adminToken}`).send({ userId: writerUserId });
    expect(dupe.status).toBe(409);
  });

  it("rejects a userId that does not exist", async () => {
    const res = await request(app)
      .post("/api/v1/authors")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("creating an author profile never grants elevated permissions to the linked user", async () => {
    const before = (await request(app).get(`/api/v1/users/${writerUserId}`).set("Authorization", `Bearer ${adminToken}`)).body.data.user;
    expect(before.role.key).toBe("USER");

    const writerLogin = await request(app).post("/api/v1/auth/login").send({ email: "writer@example.com", password: "WriterPassword123" });
    const writerToken = writerLogin.body.data.session.token;
    // The linked user still only has whatever their own role grants —
    // becoming an "author" is profile data, not an identity/permission change.
    expect((await request(app).post("/api/v1/pages").set("Authorization", `Bearer ${writerToken}`).send({ title: "X" })).status).toBe(201);
    expect((await request(app).delete(`/api/v1/pages/nonexistent-id`).set("Authorization", `Bearer ${writerToken}`)).status).not.toBe(200);
  });

  it("updates an author's bio/avatar", async () => {
    const author = await prisma.author.findFirst({ where: { userId: writerUserId } });
    const res = await request(app).patch(`/api/v1/authors/${author!.id}`).set("Authorization", `Bearer ${adminToken}`).send({ bio: "Updated bio." });
    expect(res.status).toBe(200);
    expect(res.body.data.author.bio).toBe("Updated bio.");
  });

  it("enforces permissions: VIEWER can read but not create/update", async () => {
    expect((await request(app).get("/api/v1/authors").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post("/api/v1/authors").set("Authorization", `Bearer ${viewerToken}`).send({ userId: writerUserId })).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/authors")).status).toBe(401);
  });
});
