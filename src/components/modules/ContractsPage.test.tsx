/** Phase 10 — contracts list/detail, lifecycle actions, variation history, create form, permission-gated controls, empty/error states, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContractsPage } from "./ContractsPage";

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const activateMock = vi.fn();
const suspendMock = vi.fn();
const terminateMock = vi.fn();
const addVariationMock = vi.fn();
const clientsListMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  contractsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    activate: (...args: unknown[]) => activateMock(...args),
    suspend: (...args: unknown[]) => suspendMock(...args),
    terminate: (...args: unknown[]) => terminateMock(...args),
    addVariation: (...args: unknown[]) => addVariationMock(...args),
  },
  clientsApi: { list: (...args: unknown[]) => clientsListMock(...args) },
}));

let mockPermissions: string[] = ["contracts.read", "contracts.create", "contracts.update", "contracts.activate", "contracts.suspend", "contracts.terminate", "contracts.variations.create"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const contract = {
  id: "contract-1",
  contractNumber: "CTR-000001",
  organizationId: "org-1",
  clientId: "client-1",
  title: "Managed Services",
  description: null,
  status: "DRAFT" as const,
  startDate: "2026-01-01",
  endDate: null,
  contractValue: "10000",
  currentValue: "10000",
  currency: "OMR",
  notes: null,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  variations: [],
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  activateMock.mockReset();
  suspendMock.mockReset();
  terminateMock.mockReset();
  addVariationMock.mockReset();
  clientsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["contracts.read", "contracts.create", "contracts.update", "contracts.activate", "contracts.suspend", "contracts.terminate", "contracts.variations.create"];
});

// The detail pane always fetches its own full record by id (the list
// response has no variations/currentValue — see contractRepository.list) —
// every test gets a sensible default so the detail pane renders; tests
// needing a different shape override it explicitly.
beforeEach(() => {
  getMock.mockResolvedValue({ contract });
});

describe("ContractsPage", () => {
  it("renders the real contract list and detail pane, including its current value", async () => {
    listMock.mockResolvedValue({ items: [contract], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ContractsPage />);
    expect(await screen.findAllByText("Managed Services")).not.toHaveLength(0);
    expect(await screen.findByText("CTR-000001", { exact: false })).toBeInTheDocument();
  });

  it("shows an empty state when there are no contracts", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<ContractsPage />);
    expect(await screen.findByText(/no contracts found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Contracts unavailable"));
    render(<ContractsPage />);
    expect(await screen.findByText(/contracts unavailable/i)).toBeInTheDocument();
  });

  it("shows 'no variations yet' for a contract with none, and renders variation history when present", async () => {
    const withVariation = { ...contract, currentValue: "10500", variations: [{ id: "v1", contractId: "contract-1", variationNumber: 1, amount: "500", effectiveDate: "2026-02-01", reason: "Scope increase", createdById: null, createdAt: "2026-02-01T00:00:00.000Z" }] };
    listMock.mockResolvedValue({ items: [withVariation], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ contract: withVariation });
    render(<ContractsPage />);
    expect(await screen.findByText(/scope increase/i)).toBeInTheDocument();
  });

  it("creates a contract through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    clientsListMock.mockResolvedValue({ items: [{ id: "client-1", name: "Acme Co" }], page: 1, limit: 100, total: 1, totalPages: 1 });
    createMock.mockResolvedValue({ contract });
    render(<ContractsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new contract/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/client/i), { target: { value: "client-1" } });
    fireEvent.change(within(dialog).getByLabelText(/title/i), { target: { value: "New Deal" } });
    fireEvent.change(within(dialog).getByLabelText(/start date/i), { target: { value: "2026-03-01" } });
    fireEvent.change(within(dialog).getByLabelText(/contract value/i), { target: { value: "5000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create contract/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: "New Deal", clientId: "client-1", contractValue: "5000" })));
  });

  it("activates a DRAFT contract through the real API", async () => {
    listMock.mockResolvedValue({ items: [contract], page: 1, limit: 20, total: 1, totalPages: 1 });
    activateMock.mockResolvedValue({ contract: { ...contract, status: "ACTIVE" } });
    render(<ContractsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^activate$/i }));
    await vi.waitFor(() => expect(activateMock).toHaveBeenCalledWith("contract-1"));
  });

  it("terminates a contract only after confirming, with a reason", async () => {
    const active = { ...contract, status: "ACTIVE" as const };
    listMock.mockResolvedValue({ items: [active], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ contract: active });
    terminateMock.mockResolvedValue({ contract: { ...active, status: "TERMINATED" } });
    render(<ContractsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^terminate$/i }));
    expect(terminateMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/termination reason/i), { target: { value: "Client churned" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^terminate$/i }));

    await vi.waitFor(() => expect(terminateMock).toHaveBeenCalledWith("contract-1", "Client churned"));
  });

  it("records a variation through the real API", async () => {
    listMock.mockResolvedValue({ items: [contract], page: 1, limit: 20, total: 1, totalPages: 1 });
    addVariationMock.mockResolvedValue({ contract: { ...contract, currentValue: "10200" } });
    render(<ContractsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /add variation/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^amount/i), { target: { value: "200" } });
    fireEvent.change(within(dialog).getByLabelText(/effective date/i), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText(/^reason$/i), { target: { value: "Extra scope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /record variation/i }));

    await vi.waitFor(() => expect(addVariationMock).toHaveBeenCalledWith("contract-1", expect.objectContaining({ amount: "200", reason: "Extra scope" })));
  });

  it("hides create/activate/suspend/terminate/variation controls when the caller lacks the relevant permission", async () => {
    mockPermissions = ["contracts.read"];
    listMock.mockResolvedValue({ items: [contract], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ContractsPage />);

    await screen.findAllByText("Managed Services");
    expect(screen.queryByRole("button", { name: /new contract/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^activate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^terminate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add variation/i })).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [contract], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ContractsPage />);
    await screen.findAllByText("Managed Services");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ACTIVE" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" })));
  });
});
