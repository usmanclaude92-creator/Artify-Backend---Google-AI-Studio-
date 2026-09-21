/** Phase 5 — Lead CRUD, search/filter/pagination, permission denial, tenant isolation, IDOR. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("leads", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "leads-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Leads",
      lastName: "Admin",
      organizationName: "Leads Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "leads-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "leads-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/leads");
    expect(res.status).toBe(401);
  });

  it("VIEWER (leads.read only) can list but not create", async () => {
    const list = await request(app).get("/api/v1/leads").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);

    const create = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ companyName: "Nope Co" });
    expect(create.status).toBe(403);
  });

  it("creates a lead with server-side validation (rejects missing companyName)", async () => {
    const bad = await request(app).post("/api/v1/leads").set("Authorization", `Bearer ${adminToken}`).send({ email: "x@example.com" });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Acme Corp", contactName: "Jane Doe", email: "jane@acme.com", phone: "555-0100", source: "website" });
    expect(res.status).toBe(201);
    expect(res.body.data.lead.status).toBe("NEW");
    expect(res.body.data.lead.organizationId).toBe(orgId);

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "LEAD_CREATED", resourceId: res.body.data.lead.id } });
    expect(auditRow).not.toBeNull();
  });

  it("rejects a duplicate open lead with the same email in the same organization", async () => {
    await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Dup One", email: "dupe@example.com" });
    const res = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Dup Two", email: "dupe@example.com" });
    expect(res.status).toBe(409);
  });

  it("reads, updates, and validates status transitions", async () => {
    const created = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Transition Co" });
    const id = created.body.data.lead.id;

    const get = await request(app).get(`/api/v1/leads/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(200);

    const okTransition = await request(app)
      .patch(`/api/v1/leads/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONTACTED" });
    expect(okTransition.status).toBe(200);
    expect(okTransition.body.data.lead.status).toBe("CONTACTED");

    // CONVERTED cannot be set via generic PATCH — only via the convert endpoint.
    const badTransition = await request(app)
      .patch(`/api/v1/leads/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONVERTED" });
    expect(badTransition.status).toBe(400);
  });

  it("archives (soft-deletes) a lead — it disappears from list/get but the row is not physically removed", async () => {
    const created = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Archive Me Co" });
    const id = created.body.data.lead.id;

    const del = await request(app).delete(`/api/v1/leads/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/v1/leads/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);

    const row = await prisma.lead.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("search/filter/pagination work server-side with a safe max page size", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/leads")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ companyName: `Searchable Widgets ${i}`, source: "referral" });
    }

    const searched = await request(app)
      .get("/api/v1/leads")
      .query({ search: "Searchable Widgets", limit: 2, page: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(searched.status).toBe(200);
    expect(searched.body.data.leads.length).toBeLessThanOrEqual(2);
    expect(searched.body.meta.pagination.total).toBeGreaterThanOrEqual(3);

    const filtered = await request(app)
      .get("/api/v1/leads")
      .query({ source: "referral" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.body.data.leads.every((l: { source: string }) => l.source === "referral")).toBe(true);

    const oversized = await request(app).get("/api/v1/leads").query({ limit: 999 }).set("Authorization", `Bearer ${adminToken}`);
    expect(oversized.status).toBe(400); // exceeds the max(100) — rejected, not silently clamped-and-served
  });

  it("IDOR: a user in another organization cannot read/update/delete a lead by guessing its id (404, not a leak)", async () => {
    const created = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Cross Tenant Target Co" });
    const leadId = created.body.data.lead.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "leads-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Leads Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/leads/${leadId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/leads/${leadId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ notes: "hijacked" });
    expect(patchRes.status).toBe(404);

    const delRes = await request(app).delete(`/api/v1/leads/${leadId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(delRes.status).toBe(404);

    // Confirm nothing changed.
    const stillIntact = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(stillIntact.notes).not.toBe("hijacked");
    expect(stillIntact.deletedAt).toBeNull();
  });

  it("a list request never returns another organization's leads", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({
      email: "leads-list-other@example.com",
      password: "OriginalPassword123",
      firstName: "L",
      lastName: "O",
      organizationName: "List Other Co",
    });
    const res = await request(app).get("/api/v1/leads").set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.leads.every((l: { organizationId: string }) => l.organizationId === other.body.data.user.organizationId)).toBe(true);
  });
});
