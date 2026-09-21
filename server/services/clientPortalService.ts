/**
 * Client Portal (Phase 10 §25/§26 — docs/CLIENT_PORTAL_ARCHITECTURE.md).
 * Read-only. Every method here resolves the caller's *session*
 * organizationId to the one Client row whose workspaceOrganizationId
 * matches (see clientRepository.findByWorkspaceOrganizationId's doc
 * comment for why this indirection exists), then scopes every query by
 * that Client's id AND its owning agency organizationId — never by a
 * client-supplied id. A caller whose session organization has no matching
 * Client row (e.g. an agency staffer viewing their own internal org) is
 * rejected outright, with no different behavior leaking which case it is.
 */
import { clientRepository } from "../repositories/clientRepository";
import { contractRepository } from "../repositories/contractRepository";
import { subscriptionRepository } from "../repositories/subscriptionRepository";
import { invoiceRepository } from "../repositories/invoiceRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { calculateContractCurrentValue, effectiveInvoiceStatus } from "./billingCalculations";
import { sumMoney } from "../utils/money";
import { AuthorizationError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { Client } from "@prisma/client";

async function resolveClientForCaller(caller: SanitizedUser): Promise<Client> {
  const client = await clientRepository.findByWorkspaceOrganizationId(caller.organizationId);
  if (!client) throw new AuthorizationError("No client portal is associated with the current organization.");
  return client;
}

export const clientPortalService = {
  async getDashboard(caller: SanitizedUser) {
    const client = await resolveClientForCaller(caller);
    const [contracts, subscriptions, invoices, recentPayments] = await Promise.all([
      contractRepository.listForClientInOrg(client.id, client.organizationId),
      subscriptionRepository.listForClientInOrg(client.id, client.organizationId),
      invoiceRepository.listForClientInOrg(client.id, client.organizationId),
      paymentRepository.list(client.organizationId, { clientId: client.id }, 1, 5, "paymentDate", "desc"),
    ]);

    const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
    const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE");
    const outstandingInvoices = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");

    return {
      activeContractCount: activeContracts.length,
      activeSubscriptionCount: activeSubscriptions.length,
      outstandingInvoiceCount: outstandingInvoices.length,
      amountDue: sumMoney(outstandingInvoices.map((i) => i.amountDue)),
      currency: invoices[0]?.currency ?? subscriptions[0]?.currency ?? contracts[0]?.currency,
      recentPayments: recentPayments.rows,
    };
  },

  async listContracts(caller: SanitizedUser, page: number, limit: number) {
    const client = await resolveClientForCaller(caller);
    const { rows, total } = await contractRepository.list(client.organizationId, { clientId: client.id }, page, limit, "createdAt", "desc");
    return { rows: rows.map((c) => ({ ...c, currentValue: calculateContractCurrentValue(c.contractValue, c.variations.map((v) => v.amount)) })), total };
  },

  async getContract(caller: SanitizedUser, id: string) {
    const client = await resolveClientForCaller(caller);
    const contract = await contractRepository.findByIdInOrg(id, client.organizationId);
    if (!contract || contract.clientId !== client.id) throw new NotFoundError("Contract not found.");
    return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
  },

  async listSubscriptions(caller: SanitizedUser, page: number, limit: number) {
    const client = await resolveClientForCaller(caller);
    return subscriptionRepository.list(client.organizationId, { clientId: client.id }, page, limit, "createdAt", "desc");
  },

  async getSubscription(caller: SanitizedUser, id: string) {
    const client = await resolveClientForCaller(caller);
    const subscription = await subscriptionRepository.findByIdInOrg(id, client.organizationId);
    if (!subscription || subscription.clientId !== client.id) throw new NotFoundError("Subscription not found.");
    return subscription;
  },

  async listInvoices(caller: SanitizedUser, page: number, limit: number, status?: string) {
    const client = await resolveClientForCaller(caller);
    const { rows, total } = await invoiceRepository.list(client.organizationId, { clientId: client.id, status }, page, limit, "issueDate", "desc");
    return { rows: rows.map((i) => ({ ...i, effectiveStatus: effectiveInvoiceStatus(i) })), total };
  },

  async getInvoice(caller: SanitizedUser, id: string) {
    const client = await resolveClientForCaller(caller);
    const invoice = await invoiceRepository.findByIdInOrg(id, client.organizationId);
    if (!invoice || invoice.clientId !== client.id) throw new NotFoundError("Invoice not found.");
    return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
  },

  async listPayments(caller: SanitizedUser, page: number, limit: number) {
    const client = await resolveClientForCaller(caller);
    return paymentRepository.list(client.organizationId, { clientId: client.id }, page, limit, "paymentDate", "desc");
  },
};
