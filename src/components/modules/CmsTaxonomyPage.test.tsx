/** Phase 8 — categories/tags list/create/edit/delete through the real API, permission-gated actions, no fabricated taxonomy. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CmsTaxonomyPage } from "./CmsTaxonomyPage";

const categoriesListMock = vi.fn();
const categoriesCreateMock = vi.fn();
const categoriesUpdateMock = vi.fn();
const categoriesRemoveMock = vi.fn();
const tagsListMock = vi.fn();
const tagsCreateMock = vi.fn();
const tagsRemoveMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  categoriesApi: {
    list: (...args: unknown[]) => categoriesListMock(...args),
    create: (...args: unknown[]) => categoriesCreateMock(...args),
    update: (...args: unknown[]) => categoriesUpdateMock(...args),
    remove: (...args: unknown[]) => categoriesRemoveMock(...args),
  },
  tagsApi: {
    list: (...args: unknown[]) => tagsListMock(...args),
    create: (...args: unknown[]) => tagsCreateMock(...args),
    update: vi.fn(),
    remove: (...args: unknown[]) => tagsRemoveMock(...args),
  },
}));

let mockPermissions: string[] = ["content.read", "content.create", "content.update", "content.delete"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const category = { id: "cat-1", organizationId: "org-1", slug: "news", name: "News", description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const tag = { id: "tag-1", organizationId: "org-1", slug: "launch", name: "Launch", createdAt: "2026-01-01T00:00:00.000Z" };

afterEach(() => {
  cleanup();
  categoriesListMock.mockReset();
  categoriesCreateMock.mockReset();
  categoriesUpdateMock.mockReset();
  categoriesRemoveMock.mockReset();
  tagsListMock.mockReset();
  tagsCreateMock.mockReset();
  tagsRemoveMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["content.read", "content.create", "content.update", "content.delete"];
});

describe("CmsTaxonomyPage", () => {
  it("renders categories and tags with real data, not fabricated taxonomy", async () => {
    categoriesListMock.mockResolvedValue({ categories: [category] });
    tagsListMock.mockResolvedValue({ tags: [tag] });
    render(<CmsTaxonomyPage />);
    expect(await screen.findByText("News")).toBeInTheDocument();
    expect(await screen.findByText("Launch")).toBeInTheDocument();
  });

  it("shows empty states when there are no categories/tags", async () => {
    categoriesListMock.mockResolvedValue({ categories: [] });
    tagsListMock.mockResolvedValue({ tags: [] });
    render(<CmsTaxonomyPage />);
    expect(await screen.findByText(/no categories yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/no tags yet/i)).toBeInTheDocument();
  });

  it("creates a category through the real API", async () => {
    categoriesListMock.mockResolvedValue({ categories: [] });
    tagsListMock.mockResolvedValue({ tags: [] });
    categoriesCreateMock.mockResolvedValue({ category });
    render(<CmsTaxonomyPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: /^new$/i }))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "News" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(categoriesCreateMock).toHaveBeenCalledWith(expect.objectContaining({ name: "News" })));
  });

  it("deletes a tag only after confirming the destructive dialog", async () => {
    categoriesListMock.mockResolvedValue({ categories: [] });
    tagsListMock.mockResolvedValue({ tags: [tag] });
    tagsRemoveMock.mockResolvedValue({ message: "ok" });
    render(<CmsTaxonomyPage />);

    fireEvent.click(await screen.findByLabelText(/delete tag/i));
    expect(tagsRemoveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(tagsRemoveMock).toHaveBeenCalledWith("tag-1"));
  });

  it("hides create/edit/delete actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["content.read"];
    categoriesListMock.mockResolvedValue({ categories: [category] });
    tagsListMock.mockResolvedValue({ tags: [tag] });
    render(<CmsTaxonomyPage />);

    await screen.findByText("News");
    expect(screen.queryAllByRole("button", { name: /^new$/i })).toHaveLength(0);
    expect(screen.queryByLabelText(/edit category/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/delete category/i)).not.toBeInTheDocument();
  });
});
