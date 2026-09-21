/** Phase 8 — CMS pages: searchable/filterable/paginated list + master-detail editor with workflow actions and revision history/revert. */
import React, { useEffect, useState } from "react";
import { FileText, Plus, Search, Send, Rocket, CalendarClock, Archive, History, RotateCcw, Image as ImageIcon, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { pagesApi, mediaApi, type CmsPage, type CmsMedia, type ContentRevision, type ContentStatusValue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { MediaPickerModal } from "../common/MediaPickerModal";

const FeaturedImageField: React.FC<{ mediaId: string | undefined; onChange: (mediaId: string | undefined) => void }> = ({ mediaId, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!mediaId) {
      setPreview(null);
      return;
    }
    void mediaApi.get(mediaId).then((res) => {
      if (cancelled) return;
      void mediaApi.getReadUrl(mediaId).then((urlRes) => {
        if (!cancelled) setPreview({ url: urlRes.url, label: res.media.displayName ?? res.media.originalFilename });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  return (
    <Field label="Featured image">
      <div className="flex items-center gap-3">
        {preview ? (
          <div className="w-16 h-16 rounded-lg overflow-hidden border shrink-0" style={{ borderColor: "var(--border)" }}>
            <img src={preview.url} alt={preview.label} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            className="w-16 h-16 rounded-lg border flex items-center justify-center shrink-0"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            {mediaId ? "Change" : "Choose image"}
          </Button>
          {mediaId && (
            <Button type="button" variant="ghost" onClick={() => onChange(undefined)} aria-label="Remove featured image">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m: CmsMedia) => {
          onChange(m.id);
          setPickerOpen(false);
        }}
      />
    </Field>
  );
};

const STATUS_OPTIONS: ContentStatusValue[] = ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<ContentStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

const PageFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: (page?: CmsPage) => void; mode: "create" | "edit"; page?: CmsPage }> = ({
  open,
  onClose,
  onSaved,
  mode,
  page,
}) => {
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [body, setBody] = useState(page?.currentRevision?.body ?? "");
  const [featuredMediaId, setFeaturedMediaId] = useState<string | undefined>(page?.featuredMediaId ?? undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(page?.title ?? "");
      setSlug(page?.slug ?? "");
      setBody(page?.currentRevision?.body ?? "");
      setFeaturedMediaId(page?.featuredMediaId ?? undefined);
      setError(null);
    }
  }, [open, page]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await pagesApi.create({ title, slug: slug || undefined, body, featuredMediaId });
        onSaved(res.page);
      } else if (page) {
        const res = await pagesApi.update(page.id, {
          title,
          slug,
          body,
          featuredMediaId: featuredMediaId ?? null,
          expectedUpdatedAt: page.updatedAt,
        });
        onSaved(res.page);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save page.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New page" : `Edit ${page?.title}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Slug" hint="Leave blank to auto-generate from the title.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
        </Field>
        <FeaturedImageField mediaId={featuredMediaId} onChange={setFeaturedMediaId} />
        <Field label="Body">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none font-mono"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create page" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ScheduleModal: React.FC<{ open: boolean; onClose: () => void; onSchedule: (scheduledAt: string) => void }> = ({ open, onClose, onSchedule }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Schedule publish">
      <div className="space-y-3">
        <Field label="Publish at">
          <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onSchedule(new Date(value).toISOString())}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const PageDetail: React.FC<{ page: CmsPage; onChanged: (p?: CmsPage) => void }> = ({ page, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "content.update");
  const canPublish = hasPermission(user?.role.permissions, "content.publish");
  const canDelete = hasPermission(user?.role.permissions, "content.delete");

  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await pagesApi.revisions(page.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const run = async (action: () => Promise<{ page: CmsPage }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.page);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = () => run(() => pagesApi.update(page.id, { status: "DRAFT" }), "Page restored to draft.");
  const handleSubmitReview = () => run(() => pagesApi.submitForReview(page.id), "Submitted for review.");
  const handlePublish = () => run(() => pagesApi.publish(page.id), "Page published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => pagesApi.archive(page.id), "Page archived.");
  };
  const handleSchedule = async (scheduledAt: string) => {
    setScheduleOpen(false);
    await run(() => pagesApi.schedule(page.id, scheduledAt), "Page scheduled.");
  };
  const handleRevert = async (revisionId: string) => {
    await run(() => pagesApi.revert(page.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {page.title}
            <Badge tone={STATUS_TONE[page.status]}>{page.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            /{page.slug} · v{page.currentRevision?.version ?? "—"}
            {page.scheduledAt && page.status === "SCHEDULED" && <> · scheduled for {new Date(page.scheduledAt).toLocaleString()}</>}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
          <Button
            variant="ghost"
            onClick={() => {
              setRevisionsOpen(true);
              void loadRevisions();
            }}
          >
            <History className="w-3.5 h-3.5" /> Revisions
          </Button>
          {canUpdate && (page.status === "DRAFT" || page.status === "IN_REVIEW" || page.status === "SCHEDULED") && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {canUpdate && page.status === "DRAFT" && (
            <Button variant="secondary" onClick={() => void handleSubmitReview()} disabled={busy}>
              <Send className="w-3.5 h-3.5" /> Submit for review
            </Button>
          )}
          {canPublish && page.status !== "PUBLISHED" && page.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canPublish && page.status !== "PUBLISHED" && page.status !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={busy}>
              <CalendarClock className="w-3.5 h-3.5" /> Schedule
            </Button>
          )}
          {canUpdate && (page.status === "PUBLISHED" || page.status === "SCHEDULED" || page.status === "IN_REVIEW") && (
            <Button variant="secondary" onClick={() => void handleRestore()} disabled={busy}>
              Move to draft
            </Button>
          )}
          {canUpdate && page.status === "ARCHIVED" && (
            <Button variant="secondary" onClick={() => void handleRestore()} disabled={busy}>
              Restore
            </Button>
          )}
          {canDelete && page.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 text-xs whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
        {page.currentRevision?.body || <span style={{ color: "var(--text-muted)" }}>No body content yet.</span>}
      </div>

      <PageFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" page={page} />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={handleSchedule} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive page"
        message={`Archive "${page.title}"? It will be hidden from active use but preserved for history. This cannot be undone from here — restore it later to edit again.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <Modal open={revisionsOpen} onClose={() => setRevisionsOpen(false)} title="Revision history">
        {revisionsLoading ? (
          <LoadingState />
        ) : revisions.length === 0 ? (
          <EmptyState title="No revisions yet" description="" />
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.id} className="p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    v{r.version} <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && r.id !== page.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={busy || page.status === "ARCHIVED"}>
                    <RotateCcw className="w-3.5 h-3.5" /> Revert to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Card>
  );
};

export const PagesPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "content.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ContentStatusValue | "">("");
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [selected, setSelected] = useState<CmsPage | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPageNum(1);
  }, [debouncedSearch, status]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pagesApi.list({ page: pageNum, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setPages(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((p) => p.id === prev.id) ? res.items.find((p) => p.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pages.");
    } finally {
      setLoading(false);
    }
  }, [pageNum, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <FileText className="w-5 h-5" /> Pages
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Static content pages for this organization.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New page
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search pages…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ContentStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : pages.length === 0 ? (
        <Card>
          <EmptyState title="No pages found" description="Create a page or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{p.title}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
              </button>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {selected && <PageDetail page={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <PageFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
