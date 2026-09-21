/** Phase 6 §18-23/§39 — client-admin invitations: create, preview, accept (existing/new user), expiry, revocation, reuse, IDOR, concurrency. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("client-admin invitations", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "invite-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Invite",
      lastName: "Admin",
      organizationName: "Invite Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "invite-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "invite-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function provisionWorkspace(name: string, code: string) {
    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: code, name });
    const provision = await request(app)
      .post(`/api/v1/clients/${client.body.data.client.id}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    return { clientId: client.body.data.client.id as string, workspaceId: provision.body.data.workspace.id as string };
  }

  it("creates an invitation, never exposes a token hash, and audits CLIENT_ADMIN_INVITED", async () => {
    const { workspaceId } = await provisionWorkspace("Invite Corp", "INV-01");

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "newadmin@invitecorp.com" });
    expect(res.status).toBe(201);
    expect(res.body.data.invitation.email).toBe("newadmin@invitecorp.com");
    expect(res.body.data.invitation.tokenHash).toBeUndefined();
    expect(res.body.data.devToken).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ADMIN_INVITED", resourceId: res.body.data.invitation.id } });
    expect(audit).not.toBeNull();
  });

  it("ignores a caller-supplied role — the invited administrator always gets the fixed ADMIN role, never SUPER_ADMIN", async () => {
    const { workspaceId } = await provisionWorkspace("Role Corp", "INV-02");

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "roletest@rolecorp.com", roleKey: "SUPER_ADMIN" });
    expect(res.status).toBe(201);

    const row = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: res.body.data.invitation.id }, include: { role: true } });
    expect(row.role.key).toBe("ADMIN");
  });

  it("preview (GET /invitations/:token) is public, returns only safe fields, and requiresPassword reflects whether the email already has an account", async () => {
    const { workspaceId } = await provisionWorkspace("Preview Corp", "INV-03");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "preview@previewcorp.com" });
    const token = create.body.data.devToken;

    const preview = await request(app).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.email).toBe("preview@previewcorp.com");
    expect(preview.body.data.workspaceName).toBe("Preview Corp");
    expect(preview.body.data.requiresPassword).toBe(true);
    expect(preview.body.data.tokenHash).toBeUndefined();
  });

  it("accepts a new-user invitation: creates the user, membership, marks accepted, and issues a real session", async () => {
    const { workspaceId } = await provisionWorkspace("New User Corp", "INV-04");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "brandnew@newusercorp.com" });
    const token = create.body.data.devToken;

    const userCountBefore = await prisma.user.count();

    const accept = await request(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .send({ firstName: "Brand", lastName: "New", password: "NewUserPassword123" });
    expect(accept.status).toBe(201);
    expect(accept.body.data.session.token).toBeTruthy();
    expect(accept.body.data.user.email).toBe("brandnew@newusercorp.com");

    const userCountAfter = await prisma.user.count();
    expect(userCountAfter).toBe(userCountBefore + 1);

    const membership = await prisma.organizationMembership.findFirst({ where: { organizationId: workspaceId, user: { email: "brandnew@newusercorp.com" } } });
    expect(membership).not.toBeNull();
    expect(membership?.status).toBe("ACTIVE");

    const role = await prisma.role.findUniqueOrThrow({ where: { id: membership!.roleId } });
    expect(role.key).toBe("ADMIN");

    const row = await prisma.workspaceInvitation.findUniqueOrThrow({ where: { id: create.body.data.invitation.id } });
    expect(row.acceptedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ADMIN_ACCEPTED", resourceId: row.id } });
    expect(audit).not.toBeNull();
  });

  it("accepts an existing-user invitation without creating a duplicate account, preserving identity", async () => {
    // An account that already exists (its own, separate organization).
    const existing = await request(app).post("/api/v1/auth/register").send({
      email: "existing-admin@example.com",
      password: "ExistingPassword123",
      firstName: "Existing",
      lastName: "Admin",
      organizationName: "Existing Person Co",
    });

    const { workspaceId } = await provisionWorkspace("Existing User Corp", "INV-05");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "existing-admin@example.com" });
    const token = create.body.data.devToken;

    const preview = await request(app).get(`/api/v1/invitations/${token}`);
    expect(preview.body.data.requiresPassword).toBe(false);

    const userCountBefore = await prisma.user.count();
    const accept = await request(app).post(`/api/v1/invitations/${token}/accept`).send({});
    expect(accept.status).toBe(201);

    const userCountAfter = await prisma.user.count();
    expect(userCountAfter).toBe(userCountBefore); // no duplicate account

    expect(accept.body.data.user.id).toBe(existing.body.data.user.id);

    // Now a member of BOTH their original org and the new workspace.
    const memberships = await prisma.organizationMembership.findMany({ where: { userId: existing.body.data.user.id } });
    expect(memberships.length).toBe(2);
    expect(memberships.some((m) => m.organizationId === existing.body.data.user.organizationId)).toBe(true);
    expect(memberships.some((m) => m.organizationId === workspaceId)).toBe(true);
  });

  it("rejects an expired invitation with a generic, non-enumerating error", async () => {
    const { workspaceId } = await provisionWorkspace("Expired Corp", "INV-06");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "expired@expiredcorp.com" });
    const token = create.body.data.devToken;

    await prisma.workspaceInvitation.update({ where: { id: create.body.data.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const preview = await request(app).get(`/api/v1/invitations/${token}`);
    expect(preview.status).toBe(404);

    const accept = await request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "X", lastName: "Y", password: "SomePassword123" });
    expect(accept.status).toBe(401);
  });

  it("rejects a revoked invitation, and revoke is idempotent-safe against re-revocation", async () => {
    const { workspaceId } = await provisionWorkspace("Revoked Corp", "INV-07");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "revoked@revokedcorp.com" });
    const token = create.body.data.devToken;
    const invitationId = create.body.data.invitation.id;

    const revoke = await request(app).post(`/api/v1/invitations/${invitationId}/revoke`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(revoke.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_ADMIN_INVITATION_REVOKED", resourceId: invitationId } });
    expect(audit).not.toBeNull();

    const accept = await request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "X", lastName: "Y", password: "SomePassword123" });
    expect(accept.status).toBe(401);

    const reRevoke = await request(app).post(`/api/v1/invitations/${invitationId}/revoke`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reRevoke.status).toBe(409);
  });

  it("rejects reusing an already-accepted invitation token", async () => {
    const { workspaceId } = await provisionWorkspace("Reuse Corp", "INV-08");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "reuse@reusecorp.com" });
    const token = create.body.data.devToken;

    const first = await request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "R", lastName: "E", password: "ReusePassword123" });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "R", lastName: "E", password: "ReusePassword123" });
    expect(second.status).toBe(401);
  });

  it("a fresh invite to the same email invalidates the prior outstanding one", async () => {
    const { workspaceId } = await provisionWorkspace("Refresh Corp", "INV-09");
    const first = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "refresh@refreshcorp.com" });
    const firstToken = first.body.data.devToken;

    const second = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "refresh@refreshcorp.com" });
    expect(second.status).toBe(201);

    const oldPreview = await request(app).get(`/api/v1/invitations/${firstToken}`);
    expect(oldPreview.status).toBe(404); // revoked by the second invite
  });

  it("rejects creating/listing/revoking invitations for another organization's workspace (IDOR / cross-tenant)", async () => {
    const { workspaceId } = await provisionWorkspace("Tenant Corp", "INV-10");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "tenant@tenantcorp.com" });

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "invite-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Invite Other Co",
    });
    const otherToken = other.body.data.session.token;

    const crossCreate = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ email: "cross@tenantcorp.com" });
    expect(crossCreate.status).toBe(404);

    const crossList = await request(app).get(`/api/v1/workspaces/${workspaceId}/invitations`).set("Authorization", `Bearer ${otherToken}`);
    expect(crossList.status).toBe(404);

    const crossRevoke = await request(app)
      .post(`/api/v1/invitations/${create.body.data.invitation.id}/revoke`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send();
    expect(crossRevoke.status).toBe(404);
  });

  it("rejects invitation creation/revocation by a caller without the right permission", async () => {
    const { workspaceId } = await provisionWorkspace("Permission Corp", "INV-11");

    const createRes = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ email: "perm@permissioncorp.com" });
    expect(createRes.status).toBe(403);

    const created = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "perm2@permissioncorp.com" });

    const revokeRes = await request(app)
      .post(`/api/v1/invitations/${created.body.data.invitation.id}/revoke`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send();
    expect(revokeRes.status).toBe(403);
  });

  it("concurrency: two simultaneous acceptances of the same invitation produce exactly one membership and one accepted invitation", async () => {
    const { workspaceId } = await provisionWorkspace("Concurrent Accept Corp", "INV-12");
    const create = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "concurrent@concurrentacceptcorp.com" });
    const token = create.body.data.devToken;

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "C", lastName: "A", password: "ConcurrentPassword123" }),
      request(app).post(`/api/v1/invitations/${token}/accept`).send({ firstName: "C", lastName: "A", password: "ConcurrentPassword123" }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const users = await prisma.user.count({ where: { email: "concurrent@concurrentacceptcorp.com" } });
    expect(users).toBe(1);

    const memberships = await prisma.organizationMembership.count({ where: { organizationId: workspaceId, user: { email: "concurrent@concurrentacceptcorp.com" } } });
    expect(memberships).toBe(1);
  });
});
