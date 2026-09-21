/** Phase 6 §34 — workspace list/detail, members, invitations, status transitions, permission-gated actions. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorkspacesPage } from "./WorkspacesPage";

const listMock = vi.fn();
const updateMock = vi.fn();
const membersMock = vi.fn();
const invitationsMock = vi.fn();
const inviteMock = vi.fn();
const revokeMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  workspacesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    update: (...args: unknown[]) => updateMock(...args),
    members: (...args: unknown[]) => membersMock(...args),
    invitations: (...args: unknown[]) => invitationsMock(...args),
    invite: (...args: unknown[]) => inviteMock(...args),
  },
  invitationsApi: {
    revoke: (...args: unknown[]) => revokeMock(...args),
  },
}));

let mockPermissions: string[] = ["workspaces.read", "workspaces.update", "workspaces.suspend", "invitations.read", "invitations.create", "invitations.revoke"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const workspace = {
  id: "ws-1",
  name: "Acme Workspace",
  legalName: null,
  slug: "acme-workspace",
  type: "CLIENT" as const,
  tier: "GROWTH" as const,
  status: "ACTIVE" as const,
  email: null,
  phone: null,
  website: null,
  address: null,
  country: null,
  timezone: "UTC",
  currency: "USD",
  locale: "en",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provisionedForClient: { id: "client-1", name: "Acme Corp", clientCode: "ACME-01" },
};

const member = {
  userId: "user-1",
  email: "admin@acme.com",
  firstName: "Ada",
  lastName: "Min",
  displayName: "Ada Min",
  status: "ACTIVE" as const,
  isPrimary: true,
  roleKey: "ADMIN",
  roleName: "Administrator",
  joinedAt: "2026-01-01T00:00:00.000Z",
};

const invitation = {
  id: "inv-1",
  organizationId: "ws-1",
  email: "pending@acme.com",
  expiresAt: "2026-02-01T00:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "PENDING" as const,
  role: { key: "ADMIN", name: "Administrator" },
  invitedBy: null,
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  updateMock.mockReset();
  membersMock.mockReset();
  invitationsMock.mockReset();
  inviteMock.mockReset();
  revokeMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["workspaces.read", "workspaces.update", "workspaces.suspend", "invitations.read", "invitations.create", "invitations.revoke"];
});

beforeEach(() => {
  membersMock.mockResolvedValue({ items: [member], page: 1, limit: 50, total: 1, totalPages: 1 });
  invitationsMock.mockResolvedValue({ items: [invitation], page: 1, limit: 50, total: 1, totalPages: 1 });
});

describe("WorkspacesPage", () => {
  it("renders the workspace list/detail with real members and invitations", async () => {
    listMock.mockResolvedValue({ items: [workspace], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<WorkspacesPage />);

    expect(await screen.findAllByText("Acme Workspace")).not.toHaveLength(0);
    expect(await screen.findByText("Ada Min")).toBeInTheDocument();
    expect(screen.getByText("pending@acme.com")).toBeInTheDocument();
  });

  it("shows an empty state when there are no workspaces", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<WorkspacesPage />);
    expect(await screen.findByText(/no workspaces found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Directory down"));
    render(<WorkspacesPage />);
    expect(await screen.findByText(/directory down/i)).toBeInTheDocument();
  });

  it("suspends an active workspace only after confirming, calling workspaces.update with SUSPENDED", async () => {
    listMock.mockResolvedValue({ items: [workspace], page: 1, limit: 20, total: 1, totalPages: 1 });
    updateMock.mockResolvedValue({ workspace: { ...workspace, status: "SUSPENDED" } });
    render(<WorkspacesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^suspend$/i }));
    expect(updateMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^suspend$/i }));
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledWith("ws-1", { status: "SUSPENDED" }));
  });

  it("invites a workspace administrator through the real API", async () => {
    listMock.mockResolvedValue({ items: [workspace], page: 1, limit: 20, total: 1, totalPages: 1 });
    inviteMock.mockResolvedValue({ invitation, devToken: "art_invite_test" });
    render(<WorkspacesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /invite administrator/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: "newadmin@acme.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /send invitation/i }));

    await vi.waitFor(() => expect(inviteMock).toHaveBeenCalledWith("ws-1", "newadmin@acme.com"));
    expect(await screen.findByDisplayValue(/token=art_invite_test/)).toBeInTheDocument();
  });

  it("revokes a pending invitation only after confirming", async () => {
    listMock.mockResolvedValue({ items: [workspace], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<WorkspacesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^revoke$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^revoke$/i }));
    await vi.waitFor(() => expect(revokeMock).toHaveBeenCalledWith("inv-1"));
  });

  it("hides suspend/invite/revoke actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["workspaces.read", "invitations.read"];
    listMock.mockResolvedValue({ items: [workspace], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<WorkspacesPage />);

    await screen.findByText("Ada Min");
    expect(screen.queryByRole("button", { name: /^suspend$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite administrator/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^revoke$/i })).not.toBeInTheDocument();
  });
});
