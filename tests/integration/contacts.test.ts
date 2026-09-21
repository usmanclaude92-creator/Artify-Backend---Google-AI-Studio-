/** Phase 5 — Contact CRUD, primary-contact enforcement, tenant isolation, IDOR (§14/§26). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("contacts", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let clientId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "contacts-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Contacts",
      lastName: "Admin",
      organizationName: "Contacts Co",
    });
    adminToken = reg.body.data.session.token;

    const client = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientCode: "CT-01", name: "Contact Test Client" });
    clientId = client.body.data.client.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a contact under a client with server-side validation", async () => {
    const bad = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "OnlyFirst" });
    expect(bad.status).toBe(400);

    const res = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Jane", lastName: "Doe", email: "jane@contact.com", jobTitle: "CFO" });
    expect(res.status).toBe(201);

    const audit = await prisma.auditLog.findFirst({ where: { action: "CONTACT_CREATED", resourceId: res.body.data.contact.id } });
    expect(audit).not.toBeNull();
  });

  it("at most one primary contact per client — setting a new primary unsets the previous one", async () => {
    const first = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Primary", lastName: "One", isPrimary: true });
    expect(first.body.data.contact.isPrimary).toBe(true);

    const second = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Primary", lastName: "Two", isPrimary: true });
    expect(second.status).toBe(201);
    expect(second.body.data.contact.isPrimary).toBe(true);

    const reloadedFirst = await prisma.contact.findUniqueOrThrow({ where: { id: first.body.data.contact.id } });
    expect(reloadedFirst.isPrimary).toBe(false);

    const primaryCount = await prisma.contact.count({ where: { clientId, isPrimary: true, deletedAt: null } });
    expect(primaryCount).toBe(1);
  });

  it("rejects a duplicate email for the same client", async () => {
    await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Dup", lastName: "One", email: "dup-contact@example.com" });
    const res = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Dup", lastName: "Two", email: "dup-contact@example.com" });
    expect(res.status).toBe(409);
  });

  it("lists contacts for a client, updates, and deletes one", async () => {
    const created = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Update", lastName: "Me" });
    const id = created.body.data.contact.id;

    const list = await request(app).get(`/api/v1/clients/${clientId}/contacts`).set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.contacts.some((c: { id: string }) => c.id === id)).toBe(true);

    const updated = await request(app)
      .patch(`/api/v1/contacts/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ jobTitle: "Updated Title" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.contact.jobTitle).toBe("Updated Title");

    const del = await request(app).delete(`/api/v1/contacts/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const row = await prisma.contact.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("cannot list/create contacts under a client belonging to another organization (relationship validation)", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({
      email: "contacts-other-org@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Org",
      organizationName: "Other Contacts Co",
    });
    const otherToken = other.body.data.session.token;

    const list = await request(app).get(`/api/v1/clients/${clientId}/contacts`).set("Authorization", `Bearer ${otherToken}`);
    expect(list.status).toBe(404);

    const create = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ firstName: "Cross", lastName: "Tenant" });
    expect(create.status).toBe(404);
  });

  it("IDOR: another organization cannot read/update/delete a contact by guessing its id", async () => {
    const created = await request(app)
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "IDOR", lastName: "Target" });
    const contactId = created.body.data.contact.id;

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "contacts-idor-other@example.com",
      password: "OriginalPassword123",
      firstName: "I",
      lastName: "O",
      organizationName: "Contacts IDOR Other Co",
    });
    const otherToken = other.body.data.session.token;

    const getRes = await request(app).get(`/api/v1/contacts/${contactId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(getRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/v1/contacts/${contactId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ jobTitle: "hijacked" });
    expect(patchRes.status).toBe(404);

    const delRes = await request(app).delete(`/api/v1/contacts/${contactId}`).set("Authorization", `Bearer ${otherToken}`);
    expect(delRes.status).toBe(404);
  });

  it("GET /api/v1/contacts lists the org-wide directory, tenant-scoped, optionally filtered by client", async () => {
    const res = await request(app).get("/api/v1/contacts").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contacts.length).toBeGreaterThan(0);

    const filtered = await request(app).get("/api/v1/contacts").query({ clientId }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.contacts.every((c: { clientId: string }) => c.clientId === clientId)).toBe(true);

    const other = await request(app).post("/api/v1/auth/register").send({
      email: "contacts-directory-other@example.com",
      password: "OriginalPassword123",
      firstName: "D",
      lastName: "O",
      organizationName: "Directory Other Co",
    });
    const otherRes = await request(app).get("/api/v1/contacts").set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(otherRes.body.data.contacts).toHaveLength(0);

    // A client id from a different organization is rejected, not silently ignored.
    const crossFilter = await request(app)
      .get("/api/v1/contacts")
      .query({ clientId })
      .set("Authorization", `Bearer ${other.body.data.session.token}`);
    expect(crossFilter.status).toBe(404);
  });

  it("cannot attach a contact from Organization A to a Client in Organization B", async () => {
    const orgB = await request(app).post("/api/v1/auth/register").send({
      email: "contacts-orgb@example.com",
      password: "OriginalPassword123",
      firstName: "B",
      lastName: "Org",
      organizationName: "Org B Contacts Co",
    });
    const orgBClient = await request(app)
      .post("/api/v1/clients")
      .set("Authorization", `Bearer ${orgB.body.data.session.token}`)
      .send({ clientCode: "B-01", name: "Org B Client" });

    // Org A's admin token attempts to create a contact under Org B's client id.
    const res = await request(app)
      .post(`/api/v1/clients/${orgBClient.body.data.client.id}/contacts`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ firstName: "Cross", lastName: "Org" });
    expect(res.status).toBe(404);
  });
});
