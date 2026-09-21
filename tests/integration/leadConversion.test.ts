/** Phase 5 §15-17 — lead→client conversion: transactional, idempotent, tenant/permission-checked. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("lead conversion", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "convert-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Convert",
      lastName: "Admin",
      organizationName: "Convert Co",
    });
    adminToken = reg.body.data.session.token;
    orgId = reg.body.data.user.organizationId;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "convert-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "convert-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("converts a qualified lead into a client + primary contact in one transaction, marks the lead CONVERTED, and audits both", async () => {
    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Convertible Corp", contactName: "Sam Rivera", email: "sam@convertible.com", phone: "555-0111", status: "QUALIFIED" });
    const leadId = lead.body.data.lead.id;

    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "CONV-01" });
    expect(res.status).toBe(201);
    expect(res.body.data.client.clientCode).toBe("CONV-01");
    expect(res.body.data.client.name).toBe("Convertible Corp");
    expect(res.body.data.contactId).not.toBeNull();

    const reloadedLead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(reloadedLead.status).toBe("CONVERTED");
    expect(reloadedLead.convertedClientId).toBe(res.body.data.client.id);
    expect(reloadedLead.convertedAt).not.toBeNull();

    const contact = await prisma.contact.findFirst({ where: { clientId: res.body.data.client.id } });
    expect(contact).not.toBeNull();
    expect(contact?.isPrimary).toBe(true);
    expect(contact?.firstName).toBe("Sam");

    const leadAudit = await prisma.auditLog.findFirst({ where: { action: "LEAD_CONVERTED", resourceId: leadId } });
    expect(leadAudit).not.toBeNull();
    const clientAudit = await prisma.auditLog.findFirst({ where: { action: "CLIENT_CREATED", resourceId: res.body.data.client.id } });
    expect(clientAudit).not.toBeNull();
  });

  it("rejects converting an already-converted lead with a safe 409 conflict, not a crash", async () => {
    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Already Converted Co" });
    const leadId = lead.body.data.lead.id;

    const first = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "DUPE-01" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "DUPE-02" });
    expect(second.status).toBe(409);

    // Confirm no second client/contact was created from the rejected attempt.
    const clientCount = await prisma.client.count({ where: { organizationId: orgId, clientCode: "DUPE-02" } });
    expect(clientCount).toBe(0);
  });

  it("rejects conversion by a caller without leads.convert permission", async () => {
    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Unauthorized Convert Co" });
    const leadId = lead.body.data.lead.id;

    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ clientCode: "UNAUTH-01" });
    expect(res.status).toBe(403);

    const reloaded = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(reloaded.status).not.toBe("CONVERTED");
  });

  it("rejects converting another organization's lead (cross-tenant conversion) with 404", async () => {
    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Cross Tenant Convert Co" });
    const leadId = lead.body.data.lead.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "convert-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Convert Co",
    });

    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${other.body.data.session.token}`)
      .send({ clientCode: "CROSS-01" });
    expect(res.status).toBe(404);

    const reloaded = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(reloaded.status).not.toBe("CONVERTED");

    // No client was created in the OTHER org as a side effect either.
    const leak = await prisma.client.findFirst({ where: { organizationId: other.body.data.user.organizationId, clientCode: "CROSS-01" } });
    expect(leak).toBeNull();
  });

  it("rolls back the whole transaction when the client code collides — the lead stays unconverted, no orphaned client/contact", async () => {
    // Pre-create a client that will collide with the conversion's clientCode.
    await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "COLLIDE-01", name: "Pre-existing Client" });

    const lead = await request(app)
      .post("/api/v1/leads")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ companyName: "Rollback Test Co", contactName: "Rollback Person" });
    const leadId = lead.body.data.lead.id;

    const contactCountBefore = await prisma.contact.count();

    const res = await request(app)
      .post(`/api/v1/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "COLLIDE-01" });
    expect(res.status).toBe(409);

    const reloadedLead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(reloadedLead.status).not.toBe("CONVERTED");
    expect(reloadedLead.convertedClientId).toBeNull();

    const contactCountAfter = await prisma.contact.count();
    expect(contactCountAfter).toBe(contactCountBefore); // no orphaned contact from the aborted attempt

    const clientCount = await prisma.client.count({ where: { organizationId: orgId, clientCode: "COLLIDE-01" } });
    expect(clientCount).toBe(1); // only the pre-existing one
  });
});
