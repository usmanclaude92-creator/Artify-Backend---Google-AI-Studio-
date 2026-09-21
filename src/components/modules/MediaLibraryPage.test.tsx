/** Phase 9 — Media Library grid/upload/metadata/archive/delete through the real API, permission-gated actions, loading/error/empty states, no fabricated media. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MediaLibraryPage } from "./MediaLibraryPage";

const listMock = vi.fn();
const getReadUrlMock = vi.fn();
const createUploadSessionMock = vi.fn();
const completeMock = vi.fn();
const updateMock = vi.fn();
const archiveMock = vi.fn();
const removeMock = vi.fn();
const uploadToSignedUrlMock = vi.fn();
const uploadFileMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  mediaApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    getReadUrl: (...args: unknown[]) => getReadUrlMock(...args),
    createUploadSession: (...args: unknown[]) => createUploadSessionMock(...args),
    complete: (...args: unknown[]) => completeMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    uploadToSignedUrl: (...args: unknown[]) => uploadToSignedUrlMock(...args),
    uploadFile: (...args: unknown[]) => uploadFileMock(...args),
  },
}));

let mockPermissions: string[] = ["media.read", "media.upload", "media.update", "media.delete"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const image = {
  id: "media-1",
  organizationId: "org-1",
  originalFilename: "photo.png",
  displayName: "A nice photo",
  storageProvider: "test",
  storageBucket: "media",
  storageKey: "organizations/org-1/media/media-1/photo.png",
  mimeType: "image/png",
  sizeBytes: 20480,
  checksum: null,
  width: null,
  height: null,
  durationSeconds: null,
  altText: null,
  caption: null,
  visibility: "PRIVATE" as const,
  status: "ACTIVE" as const,
  uploadedById: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

beforeEach(() => {
  getReadUrlMock.mockResolvedValue({ url: "https://example.test/signed", expiresAt: "2026-01-01T00:00:00.000Z" });
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getReadUrlMock.mockReset();
  createUploadSessionMock.mockReset();
  completeMock.mockReset();
  updateMock.mockReset();
  archiveMock.mockReset();
  removeMock.mockReset();
  uploadToSignedUrlMock.mockReset();
  uploadFileMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["media.read", "media.upload", "media.update", "media.delete"];
});

describe("MediaLibraryPage", () => {
  it("renders media with real data, not fabricated files", async () => {
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    render(<MediaLibraryPage />);
    expect(await screen.findByText("A nice photo")).toBeInTheDocument();
    await waitFor(() => expect(getReadUrlMock).toHaveBeenCalledWith("media-1"));
  });

  it("shows an empty state when there is no media", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, totalPages: 1 });
    render(<MediaLibraryPage />);
    expect(await screen.findByText(/no media found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Library unavailable"));
    render(<MediaLibraryPage />);
    expect(await screen.findByText(/library unavailable/i)).toBeInTheDocument();
  });

  it("uploads a file through the real API flow", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, totalPages: 1 });
    uploadFileMock.mockResolvedValue(image);
    render(<MediaLibraryPage />);

    fireEvent.click(await screen.findByRole("button", { name: /upload/i }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^upload$/i }));

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledWith(file, expect.objectContaining({ mimeType: "image/png" })));
  });

  it("edits media metadata through the real API", async () => {
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    updateMock.mockResolvedValue({ media: { ...image, displayName: "Updated name" } });
    render(<MediaLibraryPage />);

    fireEvent.click(await screen.findByLabelText(/edit media/i));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/display name/i), { target: { value: "Updated name" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("media-1", expect.objectContaining({ displayName: "Updated name" })));
  });

  it("archives media only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ media: { ...image, status: "ARCHIVED" } });
    render(<MediaLibraryPage />);

    fireEvent.click(await screen.findByLabelText(/archive media/i));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await waitFor(() => expect(archiveMock).toHaveBeenCalledWith("media-1"));
  });

  it("deletes media only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    removeMock.mockResolvedValue({ message: "ok" });
    render(<MediaLibraryPage />);

    fireEvent.click(await screen.findByLabelText(/delete media/i));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("media-1"));
  });

  it("hides upload/edit/archive/delete actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["media.read"];
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    render(<MediaLibraryPage />);

    await screen.findByText("A nice photo");
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/edit media/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/archive media/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/delete media/i)).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [image], page: 1, limit: 24, total: 1, totalPages: 1 });
    render(<MediaLibraryPage />);
    await screen.findByText("A nice photo");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "ARCHIVED" } });
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "ARCHIVED" })));
  });
});
