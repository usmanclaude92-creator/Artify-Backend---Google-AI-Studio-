/** Phase 9 §28 — CMS media selector: search/paginate ACTIVE images only, preview, attach. Shared by Pages and Posts featured-image fields. */
import React, { useEffect, useState } from "react";
import { Image as ImageIcon, Search } from "lucide-react";
import { mediaApi, type CmsMedia } from "../../lib/api";
import { Modal, Input, Button, LoadingState, EmptyState, Pagination } from "../ui/ui";

const MediaPickerThumb: React.FC<{ media: CmsMedia }> = ({ media }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void mediaApi
      .getReadUrl(media.id)
      .then((res) => !cancelled && setUrl(res.url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [media.id]);
  if (url) return <img src={url} alt={media.altText ?? media.originalFilename} className="w-full h-full object-cover" />;
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
      <ImageIcon className="w-5 h-5" />
    </div>
  );
};

export const MediaPickerModal: React.FC<{ open: boolean; onClose: () => void; onSelect: (media: CmsMedia) => void }> = ({ open, onClose, onSelect }) => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CmsMedia[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      setSearch("");
      setDebouncedSearch("");
      setPage(1);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Only ACTIVE media may be selected — unauthorized/inactive assets are never offered (§24/§28).
    void mediaApi
      .list({ page, limit: 24, search: debouncedSearch || undefined, status: "ACTIVE" })
      .then((res) => {
        setItems(res.items.filter((m) => m.mimeType.startsWith("image/")));
        setTotalPages(res.totalPages);
      })
      .finally(() => setLoading(false));
  }, [open, page, debouncedSearch]);

  return (
    <Modal open={open} onClose={onClose} title="Select featured image">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search images…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {loading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState title="No images found" description="Upload one from the Media Library first." />
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-80 overflow-y-auto">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m)}
                  className="aspect-square rounded-lg overflow-hidden border"
                  style={{ borderColor: "var(--border)", background: "var(--bg-app)" }}
                  title={m.displayName ?? m.originalFilename}
                >
                  <MediaPickerThumb media={m} />
                </button>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
        <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
};
