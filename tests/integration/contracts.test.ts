/** Phase 10 §46 — contracts: CRUD/lifecycle/variations/historical values/authorization/concurrency/IDOR. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("contracts", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let viewerToken: string;
  let clientId: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "contract-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Contract",
      lastName: "Admin",
      organizationName: "Contract Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "contract-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "W", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "contract-manager@example.com", password: "ManagerPassword123" })).body.data
      .session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "contract-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "contract-viewer@example.com", password: "ViewerPassword123" })).body.data
      .session.token;

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "CTR-CLIENT-1", name: "Acme Contracts" });
    clientId = client.body.data.client.id;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "other-org-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Org Co",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createContract(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/v1/contracts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, title: "Managed Services", startDate: "2026-01-01", contractValue: "10000.000", currency: "OMR", ...overrides });
    return res;
  }

  it("creates a contract with a server-generated contract number and default OMR currency", async () => {
    const res = await createContract({ currency: undefined });
    expect(res.status).toBe(201);
    expect(res.body.data.contract.contractNumber).toMatch(/^CTR-\d{6}$/);
    expect(res.body.data.contract.currency).toBe("OMR");
    expect(res.body.data.contract.status).toBe("DRAFT");
    expect(res.body.data.contract.currentValue).toBe("10000");

    const audit = await prisma.auditLog.findFirst({ where: { action: "CONTRACT_CREATED", resourceId: res.body.data.contract.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a contract for a client that does not exist in this organization", async () => {
    const res = await createContract({ clientId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("rejects endDate before startDate", async () => {
    const res = await createContract({ endDate: "2025-01-01" });
    expect(res.status).toBe(400);
  });

  it("PATCH never accepts status or contractValue — those require dedicated endpoints", async () => {
    const created = await createContract();
    const id = created.body.data.contract.id;

    const badStatus = await request(app).patch(`/api/v1/contracts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });
    expect(badStatus.status).toBe(400); // unknown field is stripped by zod's strict-ish parsing -> nothing to update fails validation? see below

    const goodPatch = await request(app).patch(`/api/v1/contracts/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ title: "Renamed Services" });
    expect(goodPatch.status).toBe(200);
    expect(goodPatch.body.data.contract.title).toBe("Renamed Services");
    expect(goodPatch.body.data.contract.status).toBe("DRAFT");
  });

  it("activate/suspend/terminate follow the server-controlled state machine, rejecting illegal transitions", async () => {
    const created = await createContract();
    const id = created.body.data.contract.id;

    const badSuspend = await request(app).post(`/api/v1/contracts/${id}/suspend`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(badSuspend.status).toBe(409); // DRAFT cannot suspend

    const activate = await request(app).post(`/api/v1/contracts/${id}/activate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(activate.status).toBe(200);
    expect(activate.body.data.contract.status).toBe("ACTIVE");

    const suspend = await request(app).post(`/api/v1/contracts/${id}/suspend`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.contract.status).toBe("SUSPENDED");

    const reactivate = await request(app).post(`/api/v1/contracts/${id}/activate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reactivate.status).toBe(200);

    const terminate = await request(app).post(`/api/v1/contracts/${id}/terminate`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Client churned" });
    expect(terminate.status).toBe(200);
    expect(terminate.body.data.contract.status).toBe("TERMINATED");

    const reactivateAfterTerminate = await request(app).post(`/api/v1/contracts/${id}/activate`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reactivateAfterTerminate.status).toBe(409);

    const auditActions = (await prisma.auditLog.findMany({ where: { resourceId: id, resourceType: "contract" } })).map((a) => a.action);
    expect(auditActions).toEqual(expect.arrayContaining(["CONTRACT_ACTIVATED", "CONTRACT_SUSPENDED", "CONTRACT_TERMINATED"]));
  });

  it("MANAGER can create/update but not activate/suspend/terminate/create variations (§34)", async () => {
    const created = await request(app)
      .post("/api/v1/contracts")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ clientId, title: "Manager Contract", startDate: "2026-01-01", contractValue: "5000.000" });
    expect(created.status).toBe(201);
    const id = created.body.data.contract.id;

    expect((await request(app).post(`/api/v1/contracts/${id}/activate`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/contracts/${id}/suspend`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/contracts/${id}/terminate`).set("Authorization", `Bearer ${managerToken}`).send({ reason: "x" })).status).toBe(403);
    expect(
      (await request(app).post(`/api/v1/contracts/${id}/variations`).set("Authorization", `Bearer ${managerToken}`).send({ amount: "100", effectiveDate: "2026-02-01", reason: "x" }))
        .status
    ).toBe(403);
  });

  it("VIEWER can read but never create/update contracts", async () => {
    const list = await request(app).get("/api/v1/contracts").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);
    const createRes = await createContract();
    const forbiddenPatch = await request(app)
      .patch(`/api/v1/contracts/${createRes.body.data.contract.id}`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ title: "x" });
    expect(forbiddenPatch.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/contracts")).status).toBe(401);
  });

  it("IDOR: a caller from a different organization cannot read, update, or act on this contract by id", async () => {
    const created = await createContract();
    const id = created.body.data.contract.id;

    expect((await request(app).get(`/api/v1/contracts/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`)).status).toBe(404);
    expect((await request(app).patch(`/api/v1/contracts/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`).send({ title: "hijacked" })).status).toBe(404);
    expect((await request(app).post(`/api/v1/contracts/${id}/activate`).set("Authorization", `Bearer ${otherOrgAdminToken}`).send()).status).toBe(404);
  });

  it("variations: never overwrite contractValue — currentValue = contractValue + Σ(variations), full history reconstructable", async () => {
    const created = await createContract({ contractValue: "10000.000" });
    const id = created.body.data.contract.id;

    const v1 = await request(app)
      .post(`/api/v1/contracts/${id}/variations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "2000.000", effectiveDate: "2026-02-01", reason: "Scope increase" });
    expect(v1.status).toBe(201);
    expect(v1.body.data.contract.currentValue).toBe("12000");
    expect(v1.body.data.contract.contractValue).toBe("10000"); // original untouched

    const v2 = await request(app)
      .post(`/api/v1/contracts/${id}/variations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "-500.000", effectiveDate: "2026-03-01", reason: "Scope reduction" });
    expect(v2.status).toBe(201);
    expect(v2.body.data.contract.currentValue).toBe("11500");

    const detail = await request(app).get(`/api/v1/contracts/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.contract.variations).toHaveLength(2);
    expect(detail.body.data.contract.variations[0].variationNumber).toBe(1);
    expect(detail.body.data.contract.variations[1].variationNumber).toBe(2);
    expect(detail.body.data.contract.contractValue).toBe("10000"); // still untouched after N variations
  });

  it("rejects a zero-amount variation", async () => {
    const created = await createContract();
    const res = await request(app)
      .post(`/api/v1/contracts/${created.body.data.contract.id}/variations`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "0", effectiveDate: "2026-02-01", reason: "x" });
    expect(res.status).toBe(400);
  });

  it("concurrency: N simultaneous variation creates on the same contract each get a unique sequential variationNumber, none lost", async () => {
    const created = await createContract();
    const id = created.body.data.contract.id;

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(`/api/v1/contracts/${id}/variations`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ amount: `${i + 1}00.000`, effectiveDate: "2026-02-01", reason: `variation ${i}` })
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const variations = await prisma.contractVariation.findMany({ where: { contractId: id } });
    expect(variations).toHaveLength(5);
    const numbers = variations.map((v) => v.variationNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("searches/filters/paginates contracts server-side", async () => {
    await createContract({ title: "Findable Alpha Contract" });
    await createContract({ title: "Findable Beta Contract" });

    const search = await request(app).get("/api/v1/contracts").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.body.data.contracts.length).toBeGreaterThanOrEqual(2);

    const byClient = await request(app).get("/api/v1/contracts").query({ clientId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byClient.body.data.contracts.every((c: { clientId: string }) => c.clientId === clientId)).toBe(true);

    const paged = await request(app).get("/api/v1/contracts").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.contracts).toHaveLength(1);
  });
});
