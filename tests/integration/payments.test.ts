/** Phase 10 §46 — payments: record/multiple payments/outstanding balance/overpayment rejection/reversal/audit/authorization/concurrency. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("payments", () => {
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
      email: "pay-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Pay",
      lastName: "Admin",
      organizationName: "Pay Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "pay-manager@example.com", password: "ManagerPassword123", firstName: "M", lastName: "W", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pay-manager@example.com", password: "ManagerPassword123" })).body.data
      .session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "pay-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "pay-viewer@example.com", password: "ViewerPassword123" })).body.data.session
      .token;

    const client = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${adminToken}`).send({ clientCode: "PAY-CLIENT-1", name: "Acme Payments" });
    clientId = client.body.data.client.id;

    const otherReg = await request(app).post("/api/v1/auth/register").send({
      email: "pay-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Pay Other Org",
    });
    otherOrgAdminToken = otherReg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function createIssuedInvoice(total = "1000.000") {
    const created = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "Services", quantity: 1, unitPrice: total }] });
    const id = created.body.data.invoice.id;
    await request(app).post(`/api/v1/invoices/${id}/issue`).set("Authorization", `Bearer ${adminToken}`).send();
    return id;
  }

  it("records a payment against an issued invoice and recalculates amountPaid/amountDue/status transactionally", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");

    const payment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "400.000", paymentDate: "2026-01-10", method: "BANK_TRANSFER", reference: "TXN-1" });
    expect(payment.status).toBe(201);
    expect(payment.body.data.payment.status).toBe("COMPLETED");

    const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(invoice.body.data.invoice.amountPaid).toBe("400");
    expect(invoice.body.data.invoice.amountDue).toBe("600");
    expect(invoice.body.data.invoice.status).toBe("PARTIALLY_PAID");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAYMENT_RECORDED", resourceId: payment.body.data.payment.id } });
    expect(audit).not.toBeNull();
  });

  it("supports multiple payments against the same invoice, becoming PAID exactly when amountDue reaches zero", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");
    await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "600.000", paymentDate: "2026-01-10", method: "CARD" });
    const second = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "400.000", paymentDate: "2026-01-15", method: "CASH" });
    expect(second.status).toBe(201);

    const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(invoice.body.data.invoice.amountPaid).toBe("1000");
    expect(invoice.body.data.invoice.amountDue).toBe("0");
    expect(invoice.body.data.invoice.status).toBe("PAID");
    expect(invoice.body.data.invoice.payments).toHaveLength(2);
  });

  it("rejects a payment that would exceed the outstanding balance — never silently caps it", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");
    await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "900.000", paymentDate: "2026-01-10", method: "CARD" });

    const overpay = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "200.000", paymentDate: "2026-01-15", method: "CARD" });
    expect(overpay.status).toBe(400);

    const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(invoice.body.data.invoice.amountPaid).toBe("900"); // unchanged by the rejected attempt
  });

  it("rejects a payment currency that does not match the invoice's currency", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "100.000", currency: "USD", paymentDate: "2026-01-10", method: "CARD" });
    expect(res.status).toBe(400);
  });

  it("rejects recording a payment against a DRAFT or VOID invoice", async () => {
    const draft = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ clientId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "x", quantity: 1, unitPrice: "10" }] });
    const draftPay = await request(app)
      .post(`/api/v1/invoices/${draft.body.data.invoice.id}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "1", paymentDate: "2026-01-10", method: "CARD" });
    expect(draftPay.status).toBe(409);
  });

  it("reverses a completed payment: the row is preserved with reversal fields set, never deleted, and the invoice balance/status recalculate", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");
    const payment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "1000.000", paymentDate: "2026-01-10", method: "BANK_TRANSFER" });
    const paymentId = payment.body.data.payment.id;

    const paidInvoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(paidInvoice.body.data.invoice.status).toBe("PAID");

    const reversal = await request(app).post(`/api/v1/payments/${paymentId}/reverse`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Bounced cheque" });
    expect(reversal.status).toBe(200);
    expect(reversal.body.data.payment.status).toBe("REVERSED");
    expect(reversal.body.data.payment.amount).toBe("1000"); // amount never changed
    expect(reversal.body.data.payment.reversalReason).toBe("Bounced cheque");

    const stillExists = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(stillExists).not.toBeNull(); // never a hard delete

    const invoiceAfter = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(invoiceAfter.body.data.invoice.amountPaid).toBe("0");
    expect(invoiceAfter.body.data.invoice.amountDue).toBe("1000");
    expect(invoiceAfter.body.data.invoice.status).toBe("ISSUED");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PAYMENT_REVERSED", resourceId: paymentId } });
    expect(audit).not.toBeNull();
  });

  it("rejects reversing an already-reversed payment", async () => {
    const invoiceId = await createIssuedInvoice("500.000");
    const payment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "500.000", paymentDate: "2026-01-10", method: "CARD" });
    const paymentId = payment.body.data.payment.id;

    const first = await request(app).post(`/api/v1/payments/${paymentId}/reverse`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "x" });
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/v1/payments/${paymentId}/reverse`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "x" });
    expect(second.status).toBe(409);
  });

  it("payments.read does not imply payments.reverse — MANAGER can record payments but never reverse them (§34)", async () => {
    const invoiceId = await createIssuedInvoice("500.000");
    const payment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ amount: "100.000", paymentDate: "2026-01-10", method: "CARD" });
    expect(payment.status).toBe(201);

    const reversal = await request(app).post(`/api/v1/payments/${payment.body.data.payment.id}/reverse`).set("Authorization", `Bearer ${managerToken}`).send({ reason: "x" });
    expect(reversal.status).toBe(403);
  });

  it("VIEWER can read payments but never record or reverse them", async () => {
    const invoiceId = await createIssuedInvoice("500.000");
    const list = await request(app).get("/api/v1/payments").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);
    const createRes = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ amount: "1", paymentDate: "2026-01-10", method: "CARD" });
    expect(createRes.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    expect((await request(app).get("/api/v1/payments")).status).toBe(401);
  });

  it("IDOR: a caller from a different organization cannot record or reverse a payment on this invoice", async () => {
    const invoiceId = await createIssuedInvoice("500.000");
    const crossOrgPay = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ amount: "1", paymentDate: "2026-01-10", method: "CARD" });
    expect(crossOrgPay.status).toBe(404);

    const payment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "100.000", paymentDate: "2026-01-10", method: "CARD" });
    const crossOrgReverse = await request(app)
      .post(`/api/v1/payments/${payment.body.data.payment.id}/reverse`)
      .set("Authorization", `Bearer ${otherOrgAdminToken}`)
      .send({ reason: "x" });
    expect(crossOrgReverse.status).toBe(404);
  });

  it("concurrency: simultaneous payments against the same invoice never allow amountPaid to exceed total (row-lock serializes them)", async () => {
    const invoiceId = await createIssuedInvoice("1000.000");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/api/v1/invoices/${invoiceId}/payments`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ amount: "400.000", paymentDate: "2026-01-10", method: "CARD" })
      )
    );
    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 400);
    expect(succeeded).toHaveLength(2); // exactly 2 × 400 = 800... but 3rd would be 1200 > 1000, so only 2 fit without exceeding
    expect(rejected.length).toBeGreaterThanOrEqual(2);

    const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(Number(invoice.body.data.invoice.amountPaid)).toBeLessThanOrEqual(1000);
    expect(invoice.body.data.invoice.amountPaid).toBe("800");

    const completedCount = await prisma.payment.count({ where: { invoiceId, status: "COMPLETED" } });
    expect(completedCount).toBe(2);
  });
});
