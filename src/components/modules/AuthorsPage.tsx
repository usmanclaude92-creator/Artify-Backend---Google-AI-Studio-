/** Phase 8 — CMS authors: thin byline profiles over existing platform users. No archive — the linked User's own status governs activity. */
import React, { useEffect, useState } from "react";
import { UserSquare2, Plus, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { authorsApi, type CmsAuthor } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, LoadingState, EmptyState, Modal, Field, Badge } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const AuthorFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; author?: CmsAuthor }> = ({
  open,
  onClose,
  onSaved,
  author,
}) => {
  const [userId, setUserId] = useState("");
  const [bio, setBio] = useState(author?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(author?.avatarUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUserId("");
      setBio(author?.bio ?? "");
      setAvatarUrl(author?.avatarUrl ?? "");
      setError(null);
    }
  }, [open, author]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (author) await authorsApi.update(author.id, { bio: bio || null, avatarUrl: avatarUrl || null });
      else await authorsApi.create({ userId, bio: bio || undefined, avatarUrl: avatarUrl || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save author.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={author ? `Edit ${author.user.displayName ?? author.user.email}` : "New author profile"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {!author && (
          <Field label="User ID" hint="The platform user this byline represents.">
            <Input required value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user UUID" />
          </Field>
        )}
        <Field label="Bio">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={bio ?? ""}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>
        <Field label="Avatar URL">
          <Input value={avatarUrl ?? ""} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        </Field>
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

export const AuthorsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "authors.create");
  const canUpdate = hasPermission(user?.role.permissions, "authors.update");

  const [authors, setAuthors] = useState<CmsAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; author?: CmsAuthor }>({ open: false });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authorsApi.list();
      setAuthors(res.authors);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <UserSquare2 className="w-5 h-5" /> Authors
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Byline profiles for existing platform users.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ open: true })}>
            <Plus className="w-4 h-4" /> New author
          </Button>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : authors.length === 0 ? (
        <Card>
          <EmptyState title="No author profiles yet" description="Create one to attach a byline to a platform user." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {authors.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    {a.user.displayName ?? `${a.user.firstName} ${a.user.lastName}`}
                    <Badge tone={a.user.status === "ACTIVE" ? "success" : "warning"}>{a.user.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{a.user.email}</p>
                  {a.bio && (
                    <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                      {a.bio}
                    </p>
                  )}
                </div>
                {canUpdate && (
                  <Button variant="ghost" onClick={() => setModal({ open: true, author: a })} aria-label="Edit author">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AuthorFormModal open={modal.open} onClose={() => setModal({ open: false })} onSaved={load} author={modal.author} />
    </div>
  );
};
