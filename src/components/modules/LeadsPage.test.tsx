/**
 * Phase 5 §34 — leads list, create form, permission-gated actions, lead
 * conversion, empty state, API error state. All data comes from mocked
 * `leadsApi` calls; nothing here is rendered from fabricated/local data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LeadsPage } from "./LeadsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const removeMock = vi.fn();
const convertMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  leadsApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: vi.fn(),
    remove: (...args: unknown[]) => removeMock(...args),
    convert: (...args: unknown[]) => convertMock(...args),
  },
}));

let mockPermissions: string[] = ["leads.read", "leads.create", "leads.update", "leads.delete", "leads.convert"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const lead = {
  id: "lead-1",
  organizationId: "org-1",
  companyName: "Acme Co",
  contactName: "Jane Doe",
  email: "jane@acme.com",
  phone: null,
  source: "Referral",
  status: "NEW",
  notes: null,
  assignedTo: null,
  convertedClientId: null,
  convertedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  removeMock.mockReset();
  convertMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["leads.read", "leads.create", "leads.update", "leads.delete", "leads.convert"];
});

describe("LeadsPage", () => {
  it("renders leads returned by the real API, not fabricated data", async () => {
    listMock.mockResolvedValue({ items: [lead], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<LeadsPage />);
    expect(await screen.findByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByText("jane@acme.com")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
  });

  it("shows an empty state when there are no leads", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<LeadsPage />);
    expect(await screen.findByText(/no leads found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Network unreachable"));
    render(<LeadsPage />);
    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
  });

  it("hides create/convert/delete actions when the caller lacks the permission", async () => {
    mockPermissions = ["leads.read"];
    listMock.mockResolvedValue({ items: [lead], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<LeadsPage />);
    await screen.findByText("Acme Co");
    expect(screen.queryByRole("button", { name: /new lead/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /convert/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("creates a lead through the real API when the form is submitted", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ lead });
    render(<LeadsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new lead/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/company \/ lead name/i), { target: { value: "New Co" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create lead/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ companyName: "New Co" })));
  });

  it("converts a lead to a client through the real API", async () => {
    listMock.mockResolvedValue({ items: [lead], page: 1, limit: 20, total: 1, totalPages: 1 });
    convertMock.mockResolvedValue({ client: { id: "client-1" }, contactId: null });
    render(<LeadsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /convert/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/client code/i), { target: { value: "ACME-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^convert$/i }));

    await vi.waitFor(() => expect(convertMock).toHaveBeenCalledWith("lead-1", expect.objectContaining({ clientCode: "ACME-01" })));
  });

  it("deletes a lead only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [lead], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<LeadsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith("lead-1"));
  });
});
