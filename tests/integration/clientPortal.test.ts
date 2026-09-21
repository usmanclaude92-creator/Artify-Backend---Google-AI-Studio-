/**
 * Phase 10 §25/§26/§46 — Client Portal: read access, organization isolation,
 * permission enforcement. Contract/Subscription/Invoice/Payment.organizationId
 * is always the AGENCY's own org — the portal resolves the caller's *session*
 * organizationId (after switching into a client's workspace, Phase 3's
 * switchOrganization) to the one Client row whose workspaceOrganizationId
 * matches, then scopes every query by that Client's id (see
 * clientRepository.findByWorkspaceOrganizationId's doc comment).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("client portal", () => {
  const app = createApp();
  finalizeApp(app);

  let agencyAdminToken: string;
  let clientAId: string;
  let clientAWorkspaceOrgId: string;
  let clientAPortalToken: string; // VIEWER-tier membership — a realistic read-only client user
  let clientBId: string;
  let clientBWorkspaceOrgId: string;
  let clientBPortalToken: string;
  let invoiceAId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "portal-agency-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Agency",
      lastName: "Admin",
      organizationName: "Portal Agency Co",
    });
    agencyAdminToken = reg.body.data.session.token;

    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" } });

    // Client A: fully provisioned with a contract/subscription/invoice/payment.
    const clientA = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${agencyAdminToken}`).send({ clientCode: "PORTAL-A", name: "Portal Client A" });
    clientAId = clientA.body.data.client.id;
    const workspaceA = await request(app).post(`/api/v1/clients/${clientAId}/workspace/provision`).set("Authorization", `Bearer ${agencyAdminToken}`).send({ name: "Client A Workspace" });
    clientAWorkspaceOrgId = workspaceA.body.data.workspace.id;

    const contractA = await request(app)
      .post("/api/v1/contracts")
      .set("Authorization", `Bearer ${agencyAdminToken}`)
      .send({ clientId: clientAId, title: "Client A Services", startDate: "2026-01-01", contractValue: "5000.000" });
    await request(app).post(`/api/v1/contracts/${contractA.body.data.contract.id}/activate`).set("Authorization", `Bearer ${agencyAdminToken}`).send();

    const invoiceA = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${agencyAdminToken}`)
      .send({ clientId: clientAId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "Services", quantity: 1, unitPrice: "2000.000" }] });
    invoiceAId = invoiceA.body.data.invoice.id;
    await request(app).post(`/api/v1/invoices/${invoiceAId}/issue`).set("Authorization", `Bearer ${agencyAdminToken}`).send();
    await request(app)
      .post(`/api/v1/invoices/${invoiceAId}/payments`)
      .set("Authorization", `Bearer ${agencyAdminToken}`)
      .send({ amount: "500.000", paymentDate: "2026-01-10", method: "BANK_TRANSFER" });

    // Client B: a separate, fully independent client/workspace/invoice.
    const clientB = await request(app).post("/api/v1/clients").set("Authorization", `Bearer ${agencyAdminToken}`).send({ clientCode: "PORTAL-B", name: "Portal Client B" });
    clientBId = clientB.body.data.client.id;
    const workspaceB = await request(app).post(`/api/v1/clients/${clientBId}/workspace/provision`).set("Authorization", `Bearer ${agencyAdminToken}`).send({ name: "Client B Workspace" });
    clientBWorkspaceOrgId = workspaceB.body.data.workspace.id;
    const invoiceB = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${agencyAdminToken}`)
      .send({ clientId: clientBId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "Services B", quantity: 1, unitPrice: "999.000" }] });
    await request(app).post(`/api/v1/invoices/${invoiceB.body.data.invoice.id}/issue`).set("Authorization", `Bearer ${agencyAdminToken}`).send();

    // A dedicated client-facing user per workspace, each with a read-only
    // (VIEWER) membership — a realistic external client contact, distinct
    // from the internal agency admin.
    const clientAUserReg = await request(app).post("/api/v1/auth/register").send({
      email: "client-a-user@example.com",
      password: "OriginalPassword123",
      firstName: "ClientA",
      lastName: "User",
      organizationName: "Throwaway Org For Client A User",
    });
    await prisma.organizationMembership.create({
      data: { userId: clientAUserReg.body.data.user.id, organizationId: clientAWorkspaceOrgId, roleId: viewerRole.id, status: "ACTIVE", isPrimary: false },
    });
    const switchA = await request(app)
      .post("/api/v1/auth/switch-organization")
      .set("Authorization", `Bearer ${clientAUserReg.body.data.session.token}`)
      .send({ organizationId: clientAWorkspaceOrgId });
    clientAPortalToken = switchA.body.data.session.token;

    const clientBUserReg = await request(app).post("/api/v1/auth/register").send({
      email: "client-b-user@example.com",
      password: "OriginalPassword123",
      firstName: "ClientB",
      lastName: "User",
      organizationName: "Throwaway Org For Client B User",
    });
    await prisma.organizationMembership.create({
      data: { userId: clientBUserReg.body.data.user.id, organizationId: clientBWorkspaceOrgId, roleId: viewerRole.id, status: "ACTIVE", isPrimary: false },
    });
    const switchB = await request(app)
      .post("/api/v1/auth/switch-organization")
      .set("Authorization", `Bearer ${clientBUserReg.body.data.session.token}`)
      .send({ organizationId: clientBWorkspaceOrgId });
    clientBPortalToken = switchB.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("dashboard reflects only this client's own real data — active contracts/subscriptions, outstanding invoices, amount due", async () => {
    const res = await request(app).get("/api/v1/portal/dashboard").set("Authorization", `Bearer ${clientAPortalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard.activeContractCount).toBe(1);
    expect(res.body.data.dashboard.outstandingInvoiceCount).toBe(1);
    expect(res.body.data.dashboard.amountDue).toBe("1500"); // 2000 - 500 paid
    expect(res.body.data.dashboard.recentPayments).toHaveLength(1);
  });

  it("lists and reads this client's own contracts, subscriptions, invoices, payments", async () => {
    const contracts = await request(app).get("/api/v1/portal/contracts").set("Authorization", `Bearer ${clientAPortalToken}`);
    expect(contracts.status).toBe(200);
    expect(contracts.body.data.contracts).toHaveLength(1);
    expect(contracts.body.data.contracts[0].status).toBe("ACTIVE");

    const invoices = await request(app).get("/api/v1/portal/invoices").set("Authorization", `Bearer ${clientAPortalToken}`);
    expect(invoices.status).toBe(200);
    expect(invoices.body.data.invoices).toHaveLength(1);
    expect(invoices.body.data.invoices[0].amountDue).toBe("1500");

    const invoiceDetail = await request(app).get(`/api/v1/portal/invoices/${invoiceAId}`).set("Authorization", `Bearer ${clientAPortalToken}`);
    expect(invoiceDetail.status).toBe(200);
    expect(invoiceDetail.body.data.invoice.items).toBeDefined();

    const payments = await request(app).get("/api/v1/portal/payments").set("Authorization", `Bearer ${clientAPortalToken}`);
    expect(payments.status).toBe(200);
    expect(payments.body.data.payments).toHaveLength(1);
  });

  it("cross-organization isolation: client B cannot see client A's invoices, contracts, or payments, and vice versa", async () => {
    const bInvoices = await request(app).get("/api/v1/portal/invoices").set("Authorization", `Bearer ${clientBPortalToken}`);
    expect(bInvoices.status).toBe(200);
    expect(bInvoices.body.data.invoices.every((i: { clientId: string }) => i.clientId === clientBId)).toBe(true);
    expect(bInvoices.body.data.invoices.some((i: { clientId: string }) => i.clientId === clientAId)).toBe(false);

    const bContracts = await request(app).get("/api/v1/portal/contracts").set("Authorization", `Bearer ${clientBPortalToken}`);
    expect(bContracts.body.data.contracts).toHaveLength(0); // client B has no contracts at all

    // Client B cannot fetch client A's invoice by id even directly.
    const crossFetch = await request(app).get(`/api/v1/portal/invoices/${invoiceAId}`).set("Authorization", `Bearer ${clientBPortalToken}`);
    expect(crossFetch.status).toBe(404);
  });

  it("an agency staffer viewing their own internal organization (not any client's workspace) is rejected from the portal", async () => {
    const res = await request(app).get("/api/v1/portal/dashboard").set("Authorization", `Bearer ${agencyAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("a client portal user (VIEWER-tier) can never create/update/issue/void invoices, reverse payments, or manage internal users/roles", async () => {
    const createInvoice = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${clientAPortalToken}`)
      .send({ clientId: clientAId, issueDate: "2026-01-01", dueDate: "2026-01-31", items: [{ description: "x", quantity: 1, unitPrice: "1" }] });
    expect(createInvoice.status).toBe(403);

    const issueInvoice = await request(app).post(`/api/v1/invoices/${invoiceAId}/issue`).set("Authorization", `Bearer ${clientAPortalToken}`).send();
    expect(issueInvoice.status).toBe(403);

    const recordPayment = await request(app)
      .post(`/api/v1/invoices/${invoiceAId}/payments`)
      .set("Authorization", `Bearer ${clientAPortalToken}`)
      .send({ amount: "1", paymentDate: "2026-01-10", method: "CARD" });
    expect(recordPayment.status).toBe(403);

    const createUser = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${clientAPortalToken}`)
      .send({ email: "sneaky@example.com", password: "SneakyPassword123", firstName: "S", lastName: "N", roleKey: "ADMIN" });
    expect(createUser.status).toBe(403);
  });

  it("rejects unauthenticated portal requests", async () => {
    expect((await request(app).get("/api/v1/portal/dashboard")).status).toBe(401);
    expect((await request(app).get("/api/v1/portal/invoices")).status).toBe(401);
  });
});
