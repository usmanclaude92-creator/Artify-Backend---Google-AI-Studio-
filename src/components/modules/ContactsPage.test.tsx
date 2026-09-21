/** Phase 5 §34 — org-wide contact directory: list, empty state, API error state, edit. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContactsPage } from "./ContactsPage";

const listMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const clientsListMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  contactsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
  clientsApi: {
    list: (...args: unknown[]) => clientsListMock(...args),
  },
}));

let mockPermissions: string[] = ["contacts.read", "contacts.update", "contacts.delete", "clients.read"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const contact = {
  id: "contact-1",
  organizationId: "org-1",
  clientId: "client-1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@acme.com",
  phone: null,
  jobTitle: "CFO",
  isPrimary: false,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  updateMock.mockReset();
  removeMock.mockReset();
  clientsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["contacts.read", "contacts.update", "contacts.delete", "clients.read"];
});

describe("ContactsPage", () => {
  it("renders the real contact directory returned by the API", async () => {
    clientsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    listMock.mockResolvedValue({ items: [contact], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ContactsPage />);
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("CFO")).toBeInTheDocument();
  });

  it("shows an empty state when there are no contacts", async () => {
    clientsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<ContactsPage />);
    expect(await screen.findByText(/no contacts found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    clientsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    listMock.mockRejectedValue(new Error("Timed out"));
    render(<ContactsPage />);
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
  });

  it("updates a contact through the real API when the edit form is submitted", async () => {
    clientsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    listMock.mockResolvedValue({ items: [contact], page: 1, limit: 20, total: 1, totalPages: 1 });
    updateMock.mockResolvedValue({ contact: { ...contact, jobTitle: "CEO" } });
    render(<ContactsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/job title/i), { target: { value: "CEO" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledWith("contact-1", expect.objectContaining({ jobTitle: "CEO" })));
  });

  it("hides edit/remove actions when the caller lacks the permission", async () => {
    mockPermissions = ["contacts.read"];
    clientsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    listMock.mockResolvedValue({ items: [contact], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ContactsPage />);

    await screen.findByText("Jane Doe");
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });
});
