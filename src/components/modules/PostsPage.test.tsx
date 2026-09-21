/** Phase 8 — CMS posts list/detail, category/tag assignment, create form, workflow actions, empty/error states, permission-gated actions, no fabricated posts. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PostsPage } from "./PostsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const submitForReviewMock = vi.fn();
const publishMock = vi.fn();
const archiveMock = vi.fn();
const revisionsMock = vi.fn();
const categoriesListMock = vi.fn();
const tagsListMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  postsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: (...args: unknown[]) => revisionsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    submitForReview: (...args: unknown[]) => submitForReviewMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    schedule: vi.fn(),
    archive: (...args: unknown[]) => archiveMock(...args),
    revert: vi.fn(),
  },
  categoriesApi: { list: (...args: unknown[]) => categoriesListMock(...args) },
  tagsApi: { list: (...args: unknown[]) => tagsListMock(...args) },
}));

let mockPermissions: string[] = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const category = { id: "cat-1", organizationId: "org-1", slug: "news", name: "News", description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const tag = { id: "tag-1", organizationId: "org-1", slug: "launch", name: "Launch", createdAt: "2026-01-01T00:00:00.000Z" };

const revision = {
  id: "rev-1",
  pageId: null,
  postId: "post-1",
  version: 1,
  status: "DRAFT" as const,
  title: "Launch Day",
  body: "We shipped it.",
  metadata: {},
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
};

const post = {
  id: "post-1",
  organizationId: "org-1",
  slug: "launch-day",
  title: "Launch Day",
  status: "DRAFT" as const,
  categoryId: "cat-1",
  authorId: null,
  currentRevisionId: "rev-1",
  currentRevision: revision,
  category,
  author: null,
  tags: [{ postId: "post-1", tagId: "tag-1", tag }],
  createdById: null,
  publishedAt: null,
  scheduledAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  submitForReviewMock.mockReset();
  publishMock.mockReset();
  archiveMock.mockReset();
  revisionsMock.mockReset();
  categoriesListMock.mockReset();
  tagsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
});

beforeEach(() => {
  categoriesListMock.mockResolvedValue({ categories: [category] });
  tagsListMock.mockResolvedValue({ tags: [tag] });
});

describe("PostsPage", () => {
  it("renders the post list and detail pane with real category/tag data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [post], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PostsPage />);
    expect(await screen.findAllByText("Launch Day")).not.toHaveLength(0);
    expect(await screen.findByText("We shipped it.")).toBeInTheDocument();
    expect(screen.getByText("News")).toBeInTheDocument();
    expect(screen.getByText("Launch")).toBeInTheDocument();
  });

  it("shows an empty state when there are no posts", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<PostsPage />);
    expect(await screen.findByText(/no posts found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Posts unavailable"));
    render(<PostsPage />);
    expect(await screen.findByText(/posts unavailable/i)).toBeInTheDocument();
  });

  it("creates a post with a selected category/tags through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ post });
    render(<PostsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new post/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^title$/i), { target: { value: "Launch Day" } });
    fireEvent.click(within(dialog).getByText("Launch"));
    fireEvent.click(within(dialog).getByRole("button", { name: /create post/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Launch Day", tagIds: ["tag-1"] })));
  });

  it("publishes a post through the real API", async () => {
    listMock.mockResolvedValue({ items: [post], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ post: { ...post, status: "PUBLISHED" } });
    render(<PostsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("post-1"));
  });

  it("archives a post only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [post], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ post: { ...post, status: "ARCHIVED" } });
    render(<PostsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("post-1"));
  });

  it("hides create/publish/archive actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["content.read"];
    listMock.mockResolvedValue({ items: [post], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PostsPage />);

    await screen.findByText("We shipped it.");
    expect(screen.queryByRole("button", { name: /new post/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it("filters by category, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [post], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PostsPage />);
    await screen.findByText("We shipped it.");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1]!, { target: { value: "cat-1" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "cat-1" })));
  });
});
