/** Phase 9 — Media Library: grid view, upload, search/filter/pagination, metadata editing, archive/delete, signed preview. */
import React, { useEffect, useState } from "react";
import { Image as ImageIcon, FileText, Upload, Search, Archive, Trash2, Copy, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { mediaApi, type CmsMedia, type MediaStatusValue, type AllowedMediaMimeType } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: MediaStatusValue[] = ["PENDING", "ACTIVE", "FAILED", "ARCHIVED"];
const STATUS_TONE: Record<MediaStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "warning",
  ACTIVE: "success",
  FAILED: "danger",
  ARCHIVED: "neutral",
};
const ALLOWED_MIME_TYPES: AllowedMediaMimeType[] = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "application/pdf"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

const MediaThumbnail: React.FC<{ media: CmsMedia }> = ({ media }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (isImage(media.mimeType) && media.status !== "PENDING" && media.status !== "FAILED") {
      void mediaApi
        .getReadUrl(media.id)
        .then((res) => !cancelled && setUrl(res.url))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [media.id, media.mimeType, media.status]);

  if (url) return <img src={url} alt={media.altText ?? media.displayName ?? media.originalFilename} className="w-full h-full object-cover" />;
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
      {isImage(media.mimeType) ? <ImageIcon className="w-6 h-6" /> : <FileText className="w-6 h-6" />}
    </div>
  );
};

const UploadModal: React.FC<{ open: boolean; onClose: () => void; onUploaded: () => void }> = ({ open, onClose, onUploaded }) => {
  const { notify } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setAltText("");
      setError(null);
    }
  }, [open]);

  const handleUpload = async () => {
    if (!file) return;
    setError(null);
    if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMediaMimeType)) {
      setError(`Unsupported file type: ${file.type || "unknown"}. Allowed: images (JPEG/PNG/WEBP/GIF/SVG) and PDF.`);
      return;
    }
    setUploading(true);
    try {
      await mediaApi.uploadFile(file, { mimeType: file.type as AllowedMediaMimeType, altText: altText || undefined });
      notify("Media uploaded.", "success");
      onUploaded();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Upload media">
      <div className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="File" hint="Images (JPEG, PNG, WEBP, GIF, SVG) or PDF.">
          <input
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs"
            style={{ color: "var(--text-primary)" }}
          />
        </Field>
        {file && (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {file.name} · {formatBytes(file.size)} · {file.type}
          </p>
        )}
        <Field label="Alt text" hint="Optional — describes the image for accessibility.">
          <Input value={altText} onChange={(e) => setAltText(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!file || uploading} onClick={() => void handleUpload()}>
            <Upload className="w-3.5 h-3.5" /> {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const MetadataModal: React.FC<{ open: boolean; onClose: () => void; media: CmsMedia | null; onSaved: () => void }> = ({ open, onClose, media, onSaved }) => {
  const { notify } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && media) {
      setDisplayName(media.displayName ?? "");
      setAltText(media.altText ?? "");
      setCaption(media.caption ?? "");
      setError(null);
    }
  }, [open, media]);

  if (!media) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await mediaApi.update(media.id, { displayName: displayName || null, altText: altText || null, caption: caption || null });
      notify("Media updated.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update media.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${media.originalFilename}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Alt text">
          <Input value={altText} onChange={(e) => setAltText(e.target.value)} />
        </Field>
        <Field label="Caption">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <div className="text-[11px] space-y-0.5" style={{ color: "var(--text-muted)" }}>
          <p>Type: {media.mimeType}</p>
          <p>Size: {formatBytes(media.sizeBytes)}</p>
          <p>Storage key: {media.storageKey}</p>
        </div>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const MediaLibraryPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpload = hasPermission(user?.role.permissions, "media.upload");
  const canUpdate = hasPermission(user?.role.permissions, "media.update");
  const canDelete = hasPermission(user?.role.permissions, "media.delete");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<MediaStatusValue | "">("");
  const [mimeType, setMimeType] = useState<AllowedMediaMimeType | "">("");
  const [items, setItems] = useState<CmsMedia[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CmsMedia | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CmsMedia | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CmsMedia | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, mimeType]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mediaApi.list({ page, limit: 24, search: debouncedSearch || undefined, status: status || undefined, mimeType: mimeType || undefined });
      setItems(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load media.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, mimeType]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await mediaApi.archive(archiveTarget.id);
      notify("Media archived.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive media.", "error");
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await mediaApi.remove(deleteTarget.id);
      notify("Media deleted.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete media.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleCopyId = (media: CmsMedia) => {
    void navigator.clipboard?.writeText(media.id).then(
      () => notify("Media ID copied.", "success"),
      () => notify("Could not copy to clipboard.", "error")
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <ImageIcon className="w-5 h-5" /> Media Library
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Images and documents available to Pages and Posts.
          </p>
        </div>
        {canUpload && (
          <Button variant="primary" onClick={() => setUploadOpen(true)}>
            <Upload className="w-4 h-4" /> Upload
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search media…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as MediaStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={mimeType} onChange={(e) => setMimeType(e.target.value as AllowedMediaMimeType | "")}>
          <option value="">All types</option>
          {ALLOWED_MIME_TYPES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No media found" description="Upload a file or adjust your filters." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            {items.map((m) => (
              <Card key={m.id} className="overflow-hidden flex flex-col">
                <div className="aspect-square" style={{ background: "var(--bg-app)" }}>
                  <MediaThumbnail media={m} />
                </div>
                <div className="p-2 space-y-1">
                  <p className="text-[11px] font-semibold truncate" style={{ color: "var(--text-primary)" }} title={m.originalFilename}>
                    {m.displayName || m.originalFilename}
                  </p>
                  <div className="flex items-center justify-between gap-1">
                    <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatBytes(m.sizeBytes)}
                    </span>
                  </div>
                  <div className="flex gap-1 flex-wrap pt-1">
                    <Button variant="ghost" onClick={() => handleCopyId(m)} aria-label="Copy media ID">
                      <Copy className="w-3 h-3" />
                    </Button>
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => setEditTarget(m)} aria-label="Edit media">
                        <Pencil className="w-3 h-3" />
                      </Button>
                    )}
                    {canDelete && m.status !== "ARCHIVED" && (
                      <Button variant="ghost" onClick={() => setArchiveTarget(m)} aria-label="Archive media">
                        <Archive className="w-3 h-3" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" onClick={() => setDeleteTarget(m)} aria-label="Delete media">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={load} />
      <MetadataModal open={!!editTarget} onClose={() => setEditTarget(null)} media={editTarget} onSaved={load} />
      <ConfirmDialog
        open={!!archiveTarget}
        title="Archive media"
        message={`Archive "${archiveTarget?.displayName ?? archiveTarget?.originalFilename}"? It will be hidden from new selections but existing references keep working.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete media"
        message={`Delete "${deleteTarget?.displayName ?? deleteTarget?.originalFilename}"? This cannot be undone. Media currently used as a featured image cannot be deleted until detached.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
