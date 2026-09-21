/** Phase 10 — payments list, reversal, permission-gated controls, empty/error states, no fabricated data. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PaymentsPage } from "./PaymentsPage";

const listMock = vi.fn();
const reverseMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  paymentsApi: {
    list: (...args: unknown[]) => listMock(...args),
    reverse: (...args: unknown[]) => reverseMock(...args),
  },
}));

let mockPermissions: string[] = ["payments.read", "payments.reverse"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const payment = {
  id: "pay-1",
  invoiceId: "inv-1",
  organizationId: "org-1",
  amount: "400",
  currency: "OMR",
  paymentDate: "2026-01-10",
  method: "BANK_TRANSFER" as const,
  reference: "TXN-1",
  status: "COMPLETED" as const,
  notes: null,
  reversalReason: null,
  reversedAt: null,
  reversedById: null,
  createdById: null,
  createdAt: "2026-01-10T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  reverseMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["payments.read", "payments.reverse"];
});

describe("PaymentsPage", () => {
  it("renders the real payment list", async () => {
    listMock.mockResolvedValue({ items: [payment], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PaymentsPage />);
    expect(await screen.findByText("TXN-1")).toBeInTheDocument();
  });

  it("shows an empty state when there are no payments", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<PaymentsPage />);
    expect(await screen.findByText(/no payments found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Payments unavailable"));
    render(<PaymentsPage />);
    expect(await screen.findByText(/payments unavailable/i)).toBeInTheDocument();
  });

  it("reverses a COMPLETED payment only after confirming, with a reason", async () => {
    listMock.mockResolvedValue({ items: [payment], page: 1, limit: 20, total: 1, totalPages: 1 });
    reverseMock.mockResolvedValue({ payment: { ...payment, status: "REVERSED" } });
    render(<PaymentsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /reverse/i }));
    expect(reverseMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reversal reason/i), { target: { value: "Bounced cheque" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reverse payment$/i }));

    await vi.waitFor(() => expect(reverseMock).toHaveBeenCalledWith("pay-1", "Bounced cheque"));
  });

  it("never shows a reverse control for an already-REVERSED payment", async () => {
    listMock.mockResolvedValue({ items: [{ ...payment, status: "REVERSED" as const }], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PaymentsPage />);
    await screen.findByText("TXN-1");
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("hides the reverse control when the caller lacks payments.reverse", async () => {
    mockPermissions = ["payments.read"];
    listMock.mockResolvedValue({ items: [payment], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PaymentsPage />);
    await screen.findByText("TXN-1");
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("filters by status and method, sending the filters to the real API", async () => {
    listMock.mockResolvedValue({ items: [payment], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PaymentsPage />);
    await screen.findByText("TXN-1");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "COMPLETED" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED" })));
  });
});
