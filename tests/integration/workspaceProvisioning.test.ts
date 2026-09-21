/** Phase 6 §13-17 — workspace provisioning: transactional, idempotent, race-safe, permission/tenant-checked. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("workspace provisioning", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "provision-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Provision",
      lastName: "Admin",
      organizationName: "Provision Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "provision-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "provision-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createClient(name: string, clientCode: string) {
    const res = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode, name });
    return res.body.data.client.id as string;
  }

  it("provisions a workspace for a client, links it 1:1, and audits WORKSPACE_PROVISIONED", async () => {
    const clientId = await createClient("Acme Provisioning Co", "PROV-01");

    const res = await request(app)
      .post(`/api/v1/clients/${clientId}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Acme Workspace" });
    expect(res.status).toBe(201);
    expect(res.body.data.workspace.name).toBe("Acme Workspace");
    expect(res.body.data.workspace.type).toBe("CLIENT");
    expect(res.body.data.workspace.status).toBe("TRIAL");

    const reloadedClient = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(reloadedClient.workspaceOrganizationId).toBe(res.body.data.workspace.id);

    const audit = await prisma.auditLog.findFirst({ where: { action: "WORKSPACE_PROVISIONED", resourceId: res.body.data.workspace.id } });
    expect(audit).not.toBeNull();

    // An onboarding record is auto-created and WORKSPACE_CREATED is marked complete.
    const onboarding = await prisma.clientOnboarding.findUnique({ where: { clientId } });
    expect(onboarding).not.toBeNull();
    const checklist = onboarding!.checklist as Array<{ key: string; completed: boolean }>;
    expect(checklist.find((c) => c.key === "WORKSPACE_CREATED")?.completed).toBe(true);
  });

  it("rejects duplicate provisioning of an already-provisioned client with 409, no second workspace", async () => {
    const clientId = await createClient("Dupe Provisioning Co", "PROV-02");

    const first = await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(first.status).toBe(201);

    const second = await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(second.status).toBe(409);

    const orgCount = await prisma.organization.count({ where: { name: { contains: "Dupe Provisioning Co" } } });
    expect(orgCount).toBe(1);
  });

  it("rejects provisioning by a caller without workspaces.create permission", async () => {
    const clientId = await createClient("Unauthorized Provisioning Co", "PROV-03");

    const res = await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${viewerToken}`).send({});
    expect(res.status).toBe(403);

    const reloaded = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(reloaded.workspaceOrganizationId).toBeNull();
  });

  it("rejects provisioning for another organization's client (cross-tenant) with 404", async () => {
    const clientId = await createClient("Cross Tenant Provisioning Co", "PROV-04");

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "provision-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Provisioning Co",
    });

    const res = await request(app)
      .post(`/api/v1/clients/${clientId}/workspace/provision`)
      .set("Authorization", `Bearer ${other.body.data.session.token}`)
      .send({});
    expect(res.status).toBe(404);

    const reloaded = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(reloaded.workspaceOrganizationId).toBeNull();
  });

  it("concurrency: two simultaneous provisioning requests for the same client produce exactly one workspace", async () => {
    const clientId = await createClient("Concurrent Provisioning Co", "PROV-05");

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({}),
      request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({}),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const reloaded = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(reloaded.workspaceOrganizationId).not.toBeNull();

    const winner = first.status === 201 ? first : second;
    const workspaceCount = await prisma.organization.count({ where: { id: winner.body.data.workspace.id } });
    expect(workspaceCount).toBe(1);
  });

  it("IDOR: another organization cannot read/update a workspace by guessing its id", async () => {
    const clientId = await createClient("IDOR Workspace Co", "PROV-06");
    const provision = await request(app)
      .post(`/api/v1/clients/${clientId}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const workspaceId = provision.body.data.workspace.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "provision-idor-other@example.com",
      password: "OriginalPassword123",
      firstName: "I",
      lastName: "O",
      organizationName: "Provisioning IDOR Other Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/workspaces/${workspaceId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "hijacked" });
    expect(patchRes.status).toBe(404);
  });

  it("lists and updates workspaces scoped to the caller's own organization, with status transitions validated", async () => {
    const clientId = await createClient("Lifecycle Workspace Co", "PROV-07");
    const provision = await request(app)
      .post(`/api/v1/clients/${clientId}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const workspaceId = provision.body.data.workspace.id;

    const list = await request(app).get("/api/v1/workspaces").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.workspaces.some((w: { id: string }) => w.id === workspaceId)).toBe(true);

    const activate = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE" });
    expect(activate.status).toBe(200);
    expect(activate.body.data.workspace.status).toBe("ACTIVE");

    // ARCHIVED is terminal — cannot go back to ACTIVE.
    await request(app).patch(`/api/v1/workspaces/${workspaceId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
    const invalidTransition = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACTIVE" });
    expect(invalidTransition.status).toBe(409);
  });

  it("suspending a workspace requires workspaces.suspend even for a caller with workspaces.update", async () => {
    const clientId = await createClient("Suspend Permission Co", "PROV-08");
    const provision = await request(app)
      .post(`/api/v1/clients/${clientId}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    const workspaceId = provision.body.data.workspace.id;
    // TRIAL cannot transition directly to SUSPENDED — activate first so the
    // permission check below is what actually rejects the request.
    await request(app).patch(`/api/v1/workspaces/${workspaceId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "provision-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "N", roleKey: "MANAGER" });
    const managerLogin = await request(app).post("/api/v1/auth/login").send({ email: "provision-manager@example.com", password: "ManagerPassword123" });
    const managerToken = managerLogin.body.data.session.token;

    // MANAGER has workspaces.update but not workspaces.suspend (prisma/rolePermissionSeed.ts).
    const res = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ status: "SUSPENDED" });
    expect(res.status).toBe(403);
  });

  it("does not hardcode a currency — an unspecified workspace defaults to USD, an explicit currency is honored", async () => {
    const clientId = await createClient("Currency Co", "PROV-09");
    const defaultRes = await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(defaultRes.body.data.workspace.currency).toBe("USD");

    const clientId2 = await createClient("Currency Co OMR", "PROV-10");
    const omrRes = await request(app)
      .post(`/api/v1/clients/${clientId2}/workspace/provision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ currency: "OMR" });
    expect(omrRes.body.data.workspace.currency).toBe("OMR");
  });

  it("provisioning updates the CRM client detail's backend-computed provisioning status", async () => {
    const clientId = await createClient("Status Indicator Co", "PROV-11");

    const before = await request(app).get(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(before.body.data.client.provisioningStatus).toBe("NOT_PROVISIONED");

    await request(app).post(`/api/v1/clients/${clientId}/workspace/provision`).set("Authorization", `Bearer ${adminToken}`).send({});
    const after = await request(app).get(`/api/v1/clients/${clientId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.data.client.provisioningStatus).toBe("PROVISIONING"); // TRIAL until explicitly activated
  });
});
