/**
 * Phase 3 — change-password and password-reset request/confirm, end to
 * end against the real HTTP app + real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { hashToken } from "../../server/utils/crypto";
import { resetDb } from "../helpers/db";

describe("change-password (Phase 3 §11)", () => {
  const app = createApp();
  finalizeApp(app);

  const creds = {
    email: "change-pw@example.com",
    password: "OriginalPassword123",
    firstName: "Change",
    lastName: "PW",
    organizationName: "Change PW Co",
  };
  let token: string;

  beforeAll(async () => {
    await resetDb();
    await request(app).post("/api/v1/auth/register").send(creds);
    const login = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    token = login.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: creds.password, newPassword: "BrandNewPassword456" });
    expect(res.status).toBe(401);
  });

  it("rejects the wrong current password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrong-current-password", newPassword: "BrandNewPassword456" });
    expect(res.status).toBe(401);
  });

  it("rejects a new password that fails policy", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: creds.password, newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a new password identical to the current one", async () => {
    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: creds.password, newPassword: creds.password });
    expect(res.status).toBe(400);
  });

  it("changes the password, revokes OTHER sessions, but keeps the current session valid", async () => {
    // A second, independent session for the same user.
    const otherLogin = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const otherToken = otherLogin.body.data.session.token;

    const res = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: creds.password, newPassword: "BrandNewPassword456" });
    expect(res.status).toBe(200);

    // The session used to make the change is still valid.
    const meWithChangeSession = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meWithChangeSession.status).toBe(200);

    // The OTHER session was revoked.
    const meWithOtherSession = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${otherToken}`);
    expect(meWithOtherSession.status).toBe(401);

    // Old password no longer works; new one does.
    const oldLogin = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: creds.email, password: "BrandNewPassword456" });
    expect(newLogin.status).toBe(200);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: creds.email } });
    expect(dbUser.passwordHash.startsWith("$2")).toBe(true);
  });
});

describe("password reset request/confirm (Phase 3 §12)", () => {
  const app = createApp();
  finalizeApp(app);

  const creds = {
    email: "reset-flow@example.com",
    password: "OriginalPassword123",
    firstName: "Reset",
    lastName: "Flow",
    organizationName: "Reset Flow Co",
  };

  beforeAll(async () => {
    await resetDb();
    await request(app).post("/api/v1/auth/register").send(creds);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("responds identically (generic message, 200) for an existing and a nonexistent email — no enumeration", async () => {
    const existing = await request(app).post("/api/v1/auth/password-reset/request").send({ email: creds.email });
    const nonexistent = await request(app)
      .post("/api/v1/auth/password-reset/request")
      .send({ email: "nobody-at-all@example.com" });

    expect(existing.status).toBe(200);
    expect(nonexistent.status).toBe(200);
    expect(existing.body.data.message).toBe(nonexistent.body.data.message);
  });

  it("returns a devToken in non-production so the flow is testable, and never persists the raw token", async () => {
    const res = await request(app).post("/api/v1/auth/password-reset/request").send({ email: creds.email });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.devToken).toBe("string");
    expect(res.body.data.devToken).toMatch(/^art_reset_/);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { email: creds.email } });
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: dbUser.id }, orderBy: { createdAt: "desc" } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).toBe(hashToken(res.body.data.devToken));
    // The raw token itself is never a column value anywhere on the row.
    expect(JSON.stringify(row)).not.toContain(res.body.data.devToken);
  });

  it("rejects confirm with an invalid token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token: "art_reset_not_a_real_token", newPassword: "AnotherPassword789" });
    expect(res.status).toBe(401);
  });

  it("a fresh request invalidates the previous token (single outstanding token per user)", async () => {
    const first = await request(app).post("/api/v1/auth/password-reset/request").send({ email: creds.email });
    const firstToken = first.body.data.devToken;
    const second = await request(app).post("/api/v1/auth/password-reset/request").send({ email: creds.email });
    expect(second.body.data.devToken).not.toBe(firstToken);

    const confirmWithFirst = await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token: firstToken, newPassword: "SupersededPassword123" });
    expect(confirmWithFirst.status).toBe(401);
  });

  it("confirms with a valid token, revokes all sessions, and the token cannot be reused", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const activeToken = login.body.data.session.token;

    const req = await request(app).post("/api/v1/auth/password-reset/request").send({ email: creds.email });
    const resetToken = req.body.data.devToken;

    const confirm = await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token: resetToken, newPassword: "FinalNewPassword123" });
    expect(confirm.status).toBe(200);

    // The session that existed BEFORE the reset is now revoked.
    const meRes = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${activeToken}`);
    expect(meRes.status).toBe(401);

    // The reset token is single-use.
    const reuse = await request(app)
      .post("/api/v1/auth/password-reset/confirm")
      .send({ token: resetToken, newPassword: "AnotherAttempt456" });
    expect(reuse.status).toBe(401);

    // New password works.
    const newLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: creds.email, password: "FinalNewPassword123" });
    expect(newLogin.status).toBe(200);
  });
});

describe("logout-all (Phase 3 §8)", () => {
  const app = createApp();
  finalizeApp(app);

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("revokes every active session for the user, including the one making the request", async () => {
    await resetDb();
    const creds = {
      email: "logout-all@example.com",
      password: "OriginalPassword123",
      firstName: "Logout",
      lastName: "All",
      organizationName: "Logout All Co",
    };
    await request(app).post("/api/v1/auth/register").send(creds);
    const loginA = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });
    const loginB = await request(app).post("/api/v1/auth/login").send({ email: creds.email, password: creds.password });

    const res = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${loginA.body.data.session.token}`);
    expect(res.status).toBe(200);

    const meA = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${loginA.body.data.session.token}`);
    const meB = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${loginB.body.data.session.token}`);
    expect(meA.status).toBe(401);
    expect(meB.status).toBe(401);
  });
});
