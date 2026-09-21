/** Phase 10 — subscriptions list/detail, lifecycle actions, create form, permission-gated controls, empty/error states, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SubscriptionsPage } from "./SubscriptionsPage";

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const activateMock = vi.fn();
const pauseMock = vi.fn();
const cancelMock = vi.fn();
const clientsListMock = vi.fn();
const productsListMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  subscriptionsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    activate: (...args: unknown[]) => activateMock(...args),
    pause: (...args: unknown[]) => pauseMock(...args),
    cancel: (...args: unknown[]) => cancelMock(...args),
  },
  clientsApi: { list: (...args: unknown[]) => clientsListMock(...args) },
  productsApi: { list: (...args: unknown[]) => productsListMock(...args) },
}));

let mockPermissions: string[] = ["subscriptions.read", "subscriptions.create", "subscriptions.update", "subscriptions.activate", "subscriptions.pause", "subscriptions.cancel"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const subscription = {
  id: "sub-1",
  subscriptionNumber: "SUB-000001",
  organizationId: "org-1",
  clientId: "client-1",
  productId: "product-1",
  status: "DRAFT" as const,
  startDate: "2026-01-01",
  renewalDate: null,
  endDate: null,
  billingCycle: "MONTHLY" as const,
  quantity: 1,
  price: "199",
  currency: "OMR",
  cancelledAt: null,
  cancellationReason: null,
  cancelledById: null,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  items: [],
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  activateMock.mockReset();
  pauseMock.mockReset();
  cancelMock.mockReset();
  clientsListMock.mockReset();
  productsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["subscriptions.read", "subscriptions.create", "subscriptions.update", "subscriptions.activate", "subscriptions.pause", "subscriptions.cancel"];
});

// The detail pane always fetches its own full record by id (the list
// response has no items — see subscriptionRepository.list) — every test
// gets a sensible default so the detail pane renders; tests needing a
// different shape override it explicitly.
beforeEach(() => {
  getMock.mockResolvedValue({ subscription });
});

describe("SubscriptionsPage", () => {
  it("renders the real subscription list and detail pane", async () => {
    listMock.mockResolvedValue({ items: [subscription], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<SubscriptionsPage />);
    expect(await screen.findAllByText("SUB-000001")).not.toHaveLength(0);
  });

  it("shows an empty state when there are no subscriptions", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<SubscriptionsPage />);
    expect(await screen.findByText(/no subscriptions found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Subscriptions unavailable"));
    render(<SubscriptionsPage />);
    expect(await screen.findByText(/subscriptions unavailable/i)).toBeInTheDocument();
  });

  it("creates a subscription through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    clientsListMock.mockResolvedValue({ items: [{ id: "client-1", name: "Acme Co" }], page: 1, limit: 100, total: 1, totalPages: 1 });
    productsListMock.mockResolvedValue({ items: [{ id: "product-1", name: "Widget" }], page: 1, limit: 100, total: 1, totalPages: 1 });
    createMock.mockResolvedValue({ subscription });
    render(<SubscriptionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new subscription/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/client/i), { target: { value: "client-1" } });
    fireEvent.change(within(dialog).getByLabelText(/product/i), { target: { value: "product-1" } });
    fireEvent.change(within(dialog).getByLabelText(/start date/i), { target: { value: "2026-03-01" } });
    fireEvent.change(within(dialog).getByLabelText(/^price$/i), { target: { value: "99" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create subscription/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1", productId: "product-1", price: "99" })));
  });

  it("activates a DRAFT subscription through the real API", async () => {
    listMock.mockResolvedValue({ items: [subscription], page: 1, limit: 20, total: 1, totalPages: 1 });
    activateMock.mockResolvedValue({ subscription: { ...subscription, status: "ACTIVE" } });
    render(<SubscriptionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^activate$/i }));
    await vi.waitFor(() => expect(activateMock).toHaveBeenCalledWith("sub-1"));
  });

  it("cancels a subscription only after confirming, with a reason", async () => {
    const active = { ...subscription, status: "ACTIVE" as const };
    listMock.mockResolvedValue({ items: [active], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ subscription: active });
    cancelMock.mockResolvedValue({ subscription: { ...active, status: "CANCELLED" } });
    render(<SubscriptionsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    expect(cancelMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/cancellation reason/i), { target: { value: "Client requested" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^cancel subscription$/i }));

    await vi.waitFor(() => expect(cancelMock).toHaveBeenCalledWith("sub-1", "Client requested"));
  });

  it("hides create/activate/pause/cancel controls when the caller lacks the relevant permission", async () => {
    mockPermissions = ["subscriptions.read"];
    listMock.mockResolvedValue({ items: [subscription], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<SubscriptionsPage />);

    await screen.findAllByText("SUB-000001");
    expect(screen.queryByRole("button", { name: /new subscription/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^activate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [subscription], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<SubscriptionsPage />);
    await screen.findAllByText("SUB-000001");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ACTIVE" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" })));
  });
});
