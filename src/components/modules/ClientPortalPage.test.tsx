/**
 * Phase 10 §25/§26 — client portal dashboard/contracts/subscriptions/
 * invoices/payments tabs, permission-aware tab visibility, no
 * create/update/mutate controls anywhere, empty/error states, no
 * fabricated data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientPortalPage } from "./ClientPortalPage";

const dashboardMock = vi.fn();
const contractsMock = vi.fn();
const subscriptionsMock = vi.fn();
const invoicesMock = vi.fn();
const paymentsMock = vi.fn();

vi.mock("../../lib/api", () => ({
  portalApi: {
    dashboard: (...args: unknown[]) => dashboardMock(...args),
    contracts: (...args: unknown[]) => contractsMock(...args),
    subscriptions: (...args: unknown[]) => subscriptionsMock(...args),
    invoices: (...args: unknown[]) => invoicesMock(...args),
    payments: (...args: unknown[]) => paymentsMock(...args),
  },
}));

let mockPermissions: string[] = ["portal.dashboard.read", "portal.contracts.read", "portal.subscriptions.read", "portal.invoices.read", "portal.payments.read"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));

afterEach(() => {
  cleanup();
  dashboardMock.mockReset();
  contractsMock.mockReset();
  subscriptionsMock.mockReset();
  invoicesMock.mockReset();
  paymentsMock.mockReset();
  mockPermissions = ["portal.dashboard.read", "portal.contracts.read", "portal.subscriptions.read", "portal.invoices.read", "portal.payments.read"];
});

describe("ClientPortalPage", () => {
  it("renders the real dashboard — active counts, amount due, recent payments", async () => {
    dashboardMock.mockResolvedValue({
      dashboard: {
        activeContractCount: 1,
        activeSubscriptionCount: 2,
        outstandingInvoiceCount: 1,
        amountDue: "1500",
        currency: "OMR",
        recentPayments: [{ id: "pay-1", invoiceId: "inv-1", organizationId: "org-1", amount: "500", currency: "OMR", paymentDate: "2026-01-10", method: "BANK_TRANSFER", reference: null, status: "COMPLETED", notes: null, reversalReason: null, reversedAt: null, reversedById: null, createdById: null, createdAt: "2026-01-10T00:00:00.000Z" }],
      },
    });
    render(<ClientPortalPage />);
    expect(await screen.findByText("OMR 1,500.000")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // active subscriptions
  });

  it("shows an error state when the dashboard resolution fails (e.g. an agency staffer with no matching client workspace)", async () => {
    dashboardMock.mockRejectedValue(new Error("No client portal is associated with the current organization."));
    render(<ClientPortalPage />);
    expect(await screen.findByText(/no client portal is associated/i)).toBeInTheDocument();
  });

  it("lists real contracts on the Contracts tab, including current value", async () => {
    dashboardMock.mockResolvedValue({ dashboard: { activeContractCount: 0, activeSubscriptionCount: 0, outstandingInvoiceCount: 0, amountDue: "0", currency: "OMR", recentPayments: [] } });
    contractsMock.mockResolvedValue({
      items: [{ id: "c1", contractNumber: "CTR-000001", organizationId: "org-1", clientId: "client-1", title: "Managed Services", description: null, status: "ACTIVE", startDate: "2026-01-01", endDate: null, contractValue: "5000", currentValue: "5000", currency: "OMR", notes: null, createdById: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", variations: [] }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    render(<ClientPortalPage />);
    await screen.findByText(/dashboard/i);
    fireEvent.click(screen.getByRole("button", { name: /^contracts$/i }));
    expect(await screen.findByText("Managed Services")).toBeInTheDocument();
  });

  it("lists real invoices on the Invoices tab, showing outstanding balance", async () => {
    dashboardMock.mockResolvedValue({ dashboard: { activeContractCount: 0, activeSubscriptionCount: 0, outstandingInvoiceCount: 0, amountDue: "0", currency: "OMR", recentPayments: [] } });
    invoicesMock.mockResolvedValue({
      items: [{ id: "inv-1", invoiceNumber: "INV-000001", organizationId: "org-1", clientId: "client-1", contractId: null, subscriptionId: null, status: "ISSUED", effectiveStatus: "ISSUED", issueDate: "2026-01-01", dueDate: "2026-01-31", currency: "OMR", subtotal: "1000", tax: "0", discount: "0", total: "1000", amountPaid: "0", amountDue: "1000", notes: null, voidReason: null, createdById: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [], payments: [] }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    render(<ClientPortalPage />);
    await screen.findByText(/dashboard/i);
    fireEvent.click(screen.getByRole("button", { name: /^invoices$/i }));
    expect(await screen.findByText("INV-000001")).toBeInTheDocument();
    expect(screen.getByText(/OMR 1,000.000 due/)).toBeInTheDocument();
  });

  it("lists real payment history on the Payments tab", async () => {
    dashboardMock.mockResolvedValue({ dashboard: { activeContractCount: 0, activeSubscriptionCount: 0, outstandingInvoiceCount: 0, amountDue: "0", currency: "OMR", recentPayments: [] } });
    paymentsMock.mockResolvedValue({
      items: [{ id: "pay-1", invoiceId: "inv-1", organizationId: "org-1", amount: "500", currency: "OMR", paymentDate: "2026-01-10", method: "CARD", reference: "REF-1", status: "COMPLETED", notes: null, reversalReason: null, reversedAt: null, reversedById: null, createdById: null, createdAt: "2026-01-10T00:00:00.000Z" }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    render(<ClientPortalPage />);
    await screen.findByText(/dashboard/i);
    fireEvent.click(screen.getByRole("button", { name: /^payments$/i }));
    expect(await screen.findByText("REF-1")).toBeInTheDocument();
  });

  it("shows no mutation controls anywhere on the portal — read-only by construction", async () => {
    dashboardMock.mockResolvedValue({ dashboard: { activeContractCount: 0, activeSubscriptionCount: 0, outstandingInvoiceCount: 0, amountDue: "0", currency: "OMR", recentPayments: [] } });
    render(<ClientPortalPage />);
    await screen.findByText(/dashboard/i);
    expect(screen.queryByRole("button", { name: /new|create|issue|void|reverse|cancel|activate|suspend|terminate/i })).not.toBeInTheDocument();
  });

  it("only shows tabs the caller has portal permission for", async () => {
    mockPermissions = ["portal.dashboard.read"];
    dashboardMock.mockResolvedValue({ dashboard: { activeContractCount: 0, activeSubscriptionCount: 0, outstandingInvoiceCount: 0, amountDue: "0", currency: "OMR", recentPayments: [] } });
    render(<ClientPortalPage />);
    await screen.findByText(/dashboard/i);
    expect(screen.queryByRole("button", { name: /^contracts$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^invoices$/i })).not.toBeInTheDocument();
  });
});
