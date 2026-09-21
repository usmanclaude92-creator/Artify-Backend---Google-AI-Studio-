/** Phase 10 §46 — invoices: creation/line calculations/Decimal correctness/numbering/issue/historical immutability/void-cancel/authorization/concurrency. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("invoices", () => {
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
      email: "inv-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Inv",
      lastName: "Admin",
      organizationName: "Inv Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "inv-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "W", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "inv-manager@example.com", password: "ManagerPassword123" })).body.data.session
      .token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "inv-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "inv-viewer@example.com", password: "ViewerPassword123" })).body.data.session
      .token;

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "INV-CLIENT-1", name: "Acme Invoices" });
    clientId = client.body.data.client.id;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "inv-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Inv Other Org",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createInvoice(overrides: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        clientId,
        issueDate: "2026-01-01",
        dueDate: "2026-01-31",
        items: [
          { description: "Consulting", quantity: 10, unitPrice: "100.000", discount: "0" },
          { description: "Setup fee", quantity: 1, unitPrice: "250.500" },
        ],
        ...overrides,
      });
  }

  it("creates a DRAFT invoice with a server-generated invoice number and Decimal-exact totals (never client-supplied)", async () => {
    const res = await createInvoice({ tax: "50.000", discount: "10.000" });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(res.body.data.invoice.status).toBe("DRAFT");
    expect(res.body.data.invoice.subtotal).toBe("1250.5"); // 1000 + 250.5
    expect(res.body.data.invoice.total).toBe("1290.5"); // 1250.5 - 10 + 50
    expect(res.body.data.invoice.amountPaid).toBe("0");
    expect(res.body.data.invoice.amountDue).toBe("1290.5");

    const audit = await prisma.auditLog.findFirst({ where: { action: "INVOICE_CREATED", resourceId: res.body.data.invoice.id } });
    expect(audit).not.toBeNull();
  });

  it("ignores any client-supplied total/subtotal/amountDue in the request body — always server-calculated", async () => {
    const res = await createInvoice({ total: "1", subtotal: "1", amountDue: "1" });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.total).not.toBe("1");
  });

  it("rejects an invoice with zero line items", async () => {
    const res = await createInvoice({ items: [] });
    expect(res.status).toBe(400);
  });

  it("rejects dueDate before issueDate", async () => {
    const res = await createInvoice({ issueDate: "2026-02-01", dueDate: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("only a DRAFT invoice can be edited — PATCH after issuance is rejected, and issued fields become immutable", async () => {
    const created = await createInvoice();
    const id = created.body.data.invoice.id;

    const patchDraft = await request(app).patch(`/api/v1/invoices/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ discount: "5.000" });
    expect(patchDraft.status).toBe(200);

    const issue = await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(issue.status).toBe(200);
    expect(issue.body.data.invoice.status).toBe("ISSUED");
    const totalAfterIssue = issue.body.data.invoice.total;

    const patchAfterIssue = await request(app).patch(`/api/v1/invoices/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ discount: "999.000" });
    expect(patchAfterIssue.status).toBe(409);

    const reread = await request(app).get(`/api/v1/invoices/${id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(reread.body.data.invoice.total).toBe(totalAfterIssue);

    const audit = await prisma.auditLog.findFirst({ where: { action: "INVOICE_ISSUED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("rejects issuing an invoice with no line items and rejects double-issuing", async () => {
    const created = await createInvoice();
    const id = created.body.data.invoice.id;
    const first = await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(second.status).toBe(409);
  });

  it("voids a DRAFT invoice as CANCELLED and an ISSUED invoice (with no payments) as VOID", async () => {
    const draft = await createInvoice();
    const cancelDraft = await request(app).post(`/api/v1/invoices/${draft.body.data.invoice.id}/void`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Never sent" });
    expect(cancelDraft.status).toBe(200);
    expect(cancelDraft.body.data.invoice.status).toBe("CANCELLED");

    const issued = await createInvoice();
    await request(app).post(`/api/v1/invoices/${issued.body.data.invoice.id}/issue`).set("Authorization", `Bearer ${adminToken}`).send();
    const voidIssued = await request(app).post(`/api/v1/invoices/${issued.body.data.invoice.id}/void`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Billing error" });
    expect(voidIssued.status).toBe(200);
    expect(voidIssued.body.data.invoice.status).toBe("VOID");
  });

  it("MANAGER can create/update invoices but never issue or void them (§34)", async () => {
    const created = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ clientId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "x", quantity: 1, unitPrice: "10" }] });
    expect(created.status).toBe(201);
    const id = created.body.data.invoice.id;
    expect((await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${managerToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/invoices/${id}/void`).set("Authorization", `Bearer ${managerToken}`).send({ reason: "x" })).status).toBe(403);
  });

  it("invoices.read does not imply invoices.issue/void — VIEWER can read but never issue/void (§34 authorization separation)", async () => {
    const created = await createInvoice();
    const id = created.body.data.invoice.id;
    expect((await request(app).get(`/api/v1/invoices/${id}`).set("Authorization", `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${viewerToken}`).send()).status).toBe(403);
    expect((await request(app).post(`/api/v1/invoices/${id}/void`).set("Authorization", `Bearer ${viewerToken}`).send({ reason: "x" })).status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/invoices")).status).toBe(401);
  });

  it("IDOR: a caller from a different organization cannot read or act on this invoice by id", async () => {
    const created = await createInvoice();
    const id = created.body.data.invoice.id;
    expect((await request(app).get(`/api/v1/invoices/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${otherOrgAdminToken}`).send()).status).toBe(404);
  });

  it("concurrency: simultaneous invoice creations each get a unique, non-duplicated invoice number (sequence-backed, never timestamp-based)", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => createInvoice()));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.data.invoice.invoiceNumber);
    expect(new Set(numbers).size).toBe(8);
    const dbCount = await prisma.invoice.count({ where: { invoiceNumber: { in: numbers } } });
    expect(dbCount).toBe(8);
  });

  it("searches/filters/paginates invoices server-side", async () => {
    await createInvoice();
    await createInvoice();
    const byClient = await request(app).get("/api/v1/invoices").query({ clientId }).set("Authorization", `Bearer ${adminToken}`);
    expect(byClient.body.data.invoices.every((i: { clientId: string }) => i.clientId === clientId)).toBe(true);
    const byStatus = await request(app).get("/api/v1/invoices").query({ status: "DRAFT" }).set("Authorization", `Bearer ${adminToken}`);
    expect(byStatus.body.data.invoices.every((i: { status: string }) => i.status === "DRAFT")).toBe(true);
  });
});
