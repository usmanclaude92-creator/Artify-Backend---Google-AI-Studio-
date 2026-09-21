/** Phase 8 — CMS pages list/detail, create form, workflow actions (submit-review/publish/schedule/archive/revert), empty/error states, permission-gated actions, no fabricated pages. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PagesPage } from "./PagesPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const submitForReviewMock = vi.fn();
const publishMock = vi.fn();
const scheduleMock = vi.fn();
const archiveMock = vi.fn();
const revertMock = vi.fn();
const revisionsMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  pagesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: (...args: unknown[]) => revisionsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    submitForReview: (...args: unknown[]) => submitForReviewMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    schedule: (...args: unknown[]) => scheduleMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    revert: (...args: unknown[]) => revertMock(...args),
  },
}));

let mockPermissions: string[] = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const revision = {
  id: "rev-1",
  pageId: "page-1",
  postId: null,
  version: 1,
  status: "DRAFT" as const,
  title: "About Us",
  body: "Hello world",
  metadata: {},
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
};

const page = {
  id: "page-1",
  organizationId: "org-1",
  slug: "about-us",
  title: "About Us",
  status: "DRAFT" as const,
  currentRevisionId: "rev-1",
  currentRevision: revision,
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
  scheduleMock.mockReset();
  archiveMock.mockReset();
  revertMock.mockReset();
  revisionsMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
});

describe("PagesPage", () => {
  it("renders the page list and detail pane with real data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PagesPage />);
    expect(await screen.findAllByText("About Us")).not.toHaveLength(0);
    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("shows an empty state when there are no pages", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<PagesPage />);
    expect(await screen.findByText(/no pages found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Pages unavailable"));
    render(<PagesPage />);
    expect(await screen.findByText(/pages unavailable/i)).toBeInTheDocument();
  });

  it("creates a page through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ page });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new page/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^title$/i), { target: { value: "About Us" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create page/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: "About Us" })));
  });

  it("submits a DRAFT page for review through the real API", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    submitForReviewMock.mockResolvedValue({ page: { ...page, status: "IN_REVIEW" } });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /submit for review/i }));
    await vi.waitFor(() => expect(submitForReviewMock).toHaveBeenCalledWith("page-1"));
  });

  it("publishes a page through the real API", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ page: { ...page, status: "PUBLISHED" } });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("page-1"));
  });

  it("schedules a page through the real API", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    scheduleMock.mockResolvedValue({ page: { ...page, status: "SCHEDULED" } });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^schedule$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/publish at/i), { target: { value: "2027-01-01T10:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^schedule$/i }));

    await vi.waitFor(() => expect(scheduleMock).toHaveBeenCalledWith("page-1", expect.any(String)));
  });

  it("archives a page only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ page: { ...page, status: "ARCHIVED" } });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("page-1"));
  });

  it("shows revision history and reverts to a prior revision through the real API", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    revisionsMock.mockResolvedValue({ revisions: [revision, { ...revision, id: "rev-2", version: 2, status: "PUBLISHED" }] });
    revertMock.mockResolvedValue({ page });
    render(<PagesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /revisions/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/v2/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /revert to this/i }));
    await vi.waitFor(() => expect(revertMock).toHaveBeenCalledWith("page-1", "rev-2"));
  });

  it("hides create/edit/publish/archive actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["content.read"];
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PagesPage />);

    await screen.findByText("Hello world");
    expect(screen.queryByRole("button", { name: /new page/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit for review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<PagesPage />);
    await screen.findByText("Hello world");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "PUBLISHED" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "PUBLISHED" })));
  });
});
