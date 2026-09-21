/** Phase 6 §34 — public invitation acceptance: preview, expired/invalid link, new-user + existing-user flows, no fabricated success. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcceptInvitationPage } from "./AcceptInvitationPage";

const previewMock = vi.fn();
const acceptMock = vi.fn();
const setSessionMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  invitationsApi: {
    preview: (...args: unknown[]) => previewMock(...args),
    accept: (...args: unknown[]) => acceptMock(...args),
  },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ setSessionFromAcceptedInvitation: setSessionMock }),
}));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/accept-invitation", navigate: navigateMock }) }));

function setUrlToken(token: string | null) {
  const search = token ? `?token=${token}` : "";
  window.history.pushState({}, "", `/accept-invitation${search}`);
}

afterEach(() => {
  cleanup();
  previewMock.mockReset();
  acceptMock.mockReset();
  setSessionMock.mockReset();
  navigateMock.mockReset();
});

describe("AcceptInvitationPage", () => {
  it("shows an invalid-link error when there is no token in the URL", async () => {
    setUrlToken(null);
    render(<AcceptInvitationPage />);
    expect(await screen.findByText(/missing its token/i)).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("shows a generic invalid/expired error for a bad token, never leaking internal details", async () => {
    setUrlToken("bad-token");
    const { ApiClientError } = await import("../../lib/apiClient");
    previewMock.mockRejectedValue(new ApiClientError("This invitation link is invalid or has expired.", { code: "NOT_FOUND", status: 404 }));
    render(<AcceptInvitationPage />);
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it("shows a password-setup form for a new-user invitation and accepts it", async () => {
    setUrlToken("new-user-token");
    previewMock.mockResolvedValue({
      email: "brandnew@acme.com",
      workspaceName: "Acme Workspace",
      roleName: "Administrator",
      expiresAt: "2026-02-01T00:00:00.000Z",
      requiresPassword: true,
    });
    acceptMock.mockResolvedValue({
      session: { token: "art_sess_test", expiresAt: "2026-02-01T00:00:00.000Z" },
      user: { id: "u1", email: "brandnew@acme.com" },
    });
    render(<AcceptInvitationPage />);

    expect(await screen.findByText(/acme workspace/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Brand" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "NewUserPassword123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "NewUserPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account & accept/i }));

    await vi.waitFor(() =>
      expect(acceptMock).toHaveBeenCalledWith("new-user-token", { firstName: "Brand", lastName: "New", password: "NewUserPassword123" })
    );
    expect(await screen.findByText(/redirecting to your workspace/i)).toBeInTheDocument();
    expect(setSessionMock).toHaveBeenCalledWith("art_sess_test", { id: "u1", email: "brandnew@acme.com" });
  });

  it("rejects a submission with mismatched passwords before calling the API", async () => {
    setUrlToken("new-user-token");
    previewMock.mockResolvedValue({
      email: "brandnew@acme.com",
      workspaceName: "Acme Workspace",
      roleName: "Administrator",
      expiresAt: "2026-02-01T00:00:00.000Z",
      requiresPassword: true,
    });
    render(<AcceptInvitationPage />);

    await screen.findByText(/acme workspace/i);
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Brand" } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "PasswordOne123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "PasswordTwo123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account & accept/i }));

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("shows no password fields for an existing-user invitation and accepts with an empty payload", async () => {
    setUrlToken("existing-user-token");
    previewMock.mockResolvedValue({
      email: "existing@acme.com",
      workspaceName: "Acme Workspace",
      roleName: "Administrator",
      expiresAt: "2026-02-01T00:00:00.000Z",
      requiresPassword: false,
    });
    acceptMock.mockResolvedValue({
      session: { token: "art_sess_existing", expiresAt: "2026-02-01T00:00:00.000Z" },
      user: { id: "u2", email: "existing@acme.com" },
    });
    render(<AcceptInvitationPage />);

    await screen.findByText(/acme workspace/i);
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^accept invitation$/i }));

    await vi.waitFor(() => expect(acceptMock).toHaveBeenCalledWith("existing-user-token", {}));
  });
});
