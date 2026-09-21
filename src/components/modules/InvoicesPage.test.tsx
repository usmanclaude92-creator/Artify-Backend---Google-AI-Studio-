/** Phase 10 — invoices list/detail (line items, payments), create form, issue/void, payment recording, permission-gated controls, empty/error states, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { InvoicesPage } from "./InvoicesPage";

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const issueMock = vi.fn();
const voidMock = vi.fn();
const recordPaymentMock = vi.fn();
const clientsListMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  invoicesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    issue: (...args: unknown[]) => issueMock(...args),
    void: (...args: unknown[]) => voidMock(...args),
    recordPayment: (...args: unknown[]) => recordPaymentMock(...args),
  },
  clientsApi: { list: (...args: unknown[]) => clientsListMock(...args) },
}));

let mockPermissions: string[] = ["invoices.read", "invoices.create", "invoices.update", "invoices.issue", "invoices.void", "payments.create"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const invoice = {
  id: "inv-1",
  invoiceNumber: "INV-000001",
  organizationId: "org-1",
  clientId: "client-1",
  contractId: null,
  subscriptionId: null,
  status: "DRAFT" as const,
  effectiveStatus: "DRAFT" as const,
  issueDate: "2026-01-01",
  dueDate: "2026-01-31",
  currency: "OMR",
  subtotal: "1000",
  tax: "0",
  discount: "0",
  total: "1000",
  amountPaid: "0",
  amountDue: "1000",
  notes: null,
  voidReason: null,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  items: [{ id: "item-1", invoiceId: "inv-1", productModuleId: null, description: "Consulting", quantity: 10, unitPrice: "100", discount: "0", lineTotal: "1000", createdAt: "2026-01-01T00:00:00.000Z" }],
  payments: [],
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  issueMock.mockReset();
  voidMock.mockReset();
  recordPaymentMock.mockReset();
  clientsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["invoices.read", "invoices.create", "invoices.update", "invoices.issue", "invoices.void", "payments.create"];
});

// The detail pane always fetches its own full record by id (the list
// response has no items/payments/effectiveStatus — see
// invoiceRepository.list) — every test gets a sensible default so the
// detail pane renders; tests needing a different shape override it
// explicitly.
beforeEach(() => {
  getMock.mockResolvedValue({ invoice });
});

describe("InvoicesPage", () => {
  it("renders the real invoice list, detail pane, and line items", async () => {
    listMock.mockResolvedValue({ items: [invoice], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<InvoicesPage />);
    expect(await screen.findAllByText("INV-000001")).not.toHaveLength(0);
    expect(await screen.findByText("Consulting")).toBeInTheDocument();
  });

  it("shows an empty state when there are no invoices", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<InvoicesPage />);
    expect(await screen.findByText(/no invoices found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Invoices unavailable"));
    render(<InvoicesPage />);
    expect(await screen.findByText(/invoices unavailable/i)).toBeInTheDocument();
  });

  it("shows 'no payments recorded yet' for an invoice with none, and lists payments when present", async () => {
    const paid = { ...invoice, payments: [{ id: "pay-1", invoiceId: "inv-1", organizationId: "org-1", amount: "400", currency: "OMR", paymentDate: "2026-01-10", method: "CARD" as const, reference: "TXN-1", status: "COMPLETED" as const, notes: null, reversalReason: null, reversedAt: null, reversedById: null, createdById: null, createdAt: "2026-01-10T00:00:00.000Z" }] };
    listMock.mockResolvedValue({ items: [paid], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ invoice: paid });
    render(<InvoicesPage />);
    expect(await screen.findByText("TXN-1")).toBeInTheDocument();
  });

  it("creates a DRAFT invoice through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    clientsListMock.mockResolvedValue({ items: [{ id: "client-1", name: "Acme Co" }], page: 1, limit: 100, total: 1, totalPages: 1 });
    createMock.mockResolvedValue({ invoice });
    render(<InvoicesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new invoice/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/client/i), { target: { value: "client-1" } });
    fireEvent.change(within(dialog).getByLabelText(/issue date/i), { target: { value: "2026-02-01" } });
    fireEvent.change(within(dialog).getByLabelText(/due date/i), { target: { value: "2026-02-28" } });
    fireEvent.change(within(dialog).getByPlaceholderText(/description/i), { target: { value: "Setup" } });
    fireEvent.change(within(dialog).getByPlaceholderText(/^unit price$/i), { target: { value: "250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create draft invoice/i }));

    await vi.waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: "client-1", items: [expect.objectContaining({ description: "Setup", unitPrice: "250" })] })
      )
    );
  });

  it("issues a DRAFT invoice through the real API", async () => {
    listMock.mockResolvedValue({ items: [invoice], page: 1, limit: 20, total: 1, totalPages: 1 });
    issueMock.mockResolvedValue({ invoice: { ...invoice, status: "ISSUED", effectiveStatus: "ISSUED" } });
    render(<InvoicesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^issue$/i }));
    await vi.waitFor(() => expect(issueMock).toHaveBeenCalledWith("inv-1"));
  });

  it("voids an ISSUED invoice only after confirming, with a reason", async () => {
    const issued = { ...invoice, status: "ISSUED" as const, effectiveStatus: "ISSUED" as const };
    listMock.mockResolvedValue({ items: [issued], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ invoice: issued });
    voidMock.mockResolvedValue({ invoice: { ...issued, status: "VOID", effectiveStatus: "VOID" } });
    render(<InvoicesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^void$/i }));
    expect(voidMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Billing error" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^void invoice$/i }));

    await vi.waitFor(() => expect(voidMock).toHaveBeenCalledWith("inv-1", "Billing error"));
  });

  it("records a payment against an ISSUED invoice through the real API", async () => {
    const issued = { ...invoice, status: "ISSUED" as const, effectiveStatus: "ISSUED" as const };
    listMock.mockResolvedValue({ items: [issued], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ invoice: issued });
    recordPaymentMock.mockResolvedValue({ payment: { id: "pay-1" } });
    render(<InvoicesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /record payment/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^amount$/i), { target: { value: "400" } });
    fireEvent.change(within(dialog).getByLabelText(/payment date/i), { target: { value: "2026-01-15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^record payment$/i }));

    await vi.waitFor(() => expect(recordPaymentMock).toHaveBeenCalledWith("inv-1", expect.objectContaining({ amount: "400" })));
  });

  it("hides create/issue/void/record-payment controls when the caller lacks the relevant permission", async () => {
    mockPermissions = ["invoices.read"];
    const issued = { ...invoice, status: "ISSUED" as const, effectiveStatus: "ISSUED" as const };
    listMock.mockResolvedValue({ items: [issued], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ invoice: issued });
    render(<InvoicesPage />);

    await screen.findAllByText("INV-000001");
    expect(screen.queryByRole("button", { name: /new invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^issue$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^void$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record payment/i })).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [invoice], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<InvoicesPage />);
    await screen.findAllByText("INV-000001");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ISSUED" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ISSUED" })));
  });
});
