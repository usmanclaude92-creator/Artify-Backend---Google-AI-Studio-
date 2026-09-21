/** Phase 8 — author profile list/create/edit through the real API, permission-gated actions, no fabricated authors. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AuthorsPage } from "./AuthorsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  authorsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

let mockPermissions: string[] = ["authors.read", "authors.create", "authors.update"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

const author = {
  id: "author-1",
  userId: "user-1",
  bio: "Writes about things.",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: { id: "user-1", email: "writer@example.com", firstName: "Wanda", lastName: "Writer", displayName: "Wanda Writer", status: "ACTIVE" },
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  mockPermissions = ["authors.read", "authors.create", "authors.update"];
});

describe("AuthorsPage", () => {
  it("renders author profiles with real linked-user data, not fabricated identities", async () => {
    listMock.mockResolvedValue({ authors: [author] });
    render(<AuthorsPage />);
    expect(await screen.findByText("Wanda Writer")).toBeInTheDocument();
    expect(screen.getByText("writer@example.com")).toBeInTheDocument();
    expect(screen.getByText("Writes about things.")).toBeInTheDocument();
  });

  it("shows an empty state when there are no author profiles", async () => {
    listMock.mockResolvedValue({ authors: [] });
    render(<AuthorsPage />);
    expect(await screen.findByText(/no author profiles yet/i)).toBeInTheDocument();
  });

  it("creates an author profile linked to a userId through the real API", async () => {
    listMock.mockResolvedValue({ authors: [] });
    createMock.mockResolvedValue({ author });
    render(<AuthorsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new author/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/user id/i), { target: { value: "user-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1" })));
  });

  it("hides create/edit actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["authors.read"];
    listMock.mockResolvedValue({ authors: [author] });
    render(<AuthorsPage />);

    await screen.findByText("Wanda Writer");
    expect(screen.queryByRole("button", { name: /new author/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/edit author/i)).not.toBeInTheDocument();
  });
});
