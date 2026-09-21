/** Phase 6 §29/§30 — workspace directory + detail (status/client/config/members/invitations). Provisioning itself happens from the CRM Client detail page. */
import React, { useEffect, useState } from "react";
import { Layers, Search, UserPlus, Ban } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  workspacesApi,
  invitationsApi,
  type Workspace,
  type WorkspaceStatusValue,
  type WorkspaceMember,
  type WorkspaceInvitation,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: WorkspaceStatusValue[] = ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"];
const STATUS_TONE: Record<WorkspaceStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  TRIAL: "info",
  ACTIVE: "success",
  SUSPENDED: "warning",
  ARCHIVED: "danger",
};
const INVITATION_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "info",
  ACCEPTED: "success",
  REVOKED: "danger",
  EXPIRED: "neutral",
};

const InviteModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; workspaceId: string }> = ({
  open,
  onClose,
  onSaved,
  workspaceId,
}) => {
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setError(null);
      setDevToken(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await workspacesApi.invite(workspaceId, email);
      notify("Invitation sent.", "success");
      if (res.devToken) setDevToken(res.devToken);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not send invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite a workspace administrator">
      {devToken ? (
        <div className="space-y-3">
          <div className="text-xs rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
            Invitation created. No email provider is configured yet (Phase 13) — share this acceptance link directly for now.
          </div>
          <Input readOnly value={`${window.location.origin}/accept-invitation?token=${devToken}`} onFocus={(e) => e.target.select()} />
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
          <Field label="Email" hint="They'll receive the appropriate workspace-administrator role.">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

const WorkspaceDetail: React.FC<{ workspace: Workspace; onChanged: (w?: Workspace) => void }> = ({ workspace, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "workspaces.update");
  const canSuspend = hasPermission(user?.role.permissions, "workspaces.suspend");
  const canInvite = hasPermission(user?.role.permissions, "invitations.create");
  const canRevoke = hasPermission(user?.role.permissions, "invitations.revoke");

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceInvitation | null>(null);
  const [statusConfirm, setStatusConfirm] = useState<WorkspaceStatusValue | null>(null);

  const loadExtra = React.useCallback(async () => {
    setLoadingExtra(true);
    try {
      const [m, i] = await Promise.all([workspacesApi.members(workspace.id, { limit: 50 }), workspacesApi.invitations(workspace.id, { limit: 50 })]);
      setMembers(m.items);
      setInvitations(i.items);
    } catch {
      setMembers([]);
      setInvitations([]);
    } finally {
      setLoadingExtra(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    void loadExtra();
  }, [loadExtra]);

  const handleStatusChange = async () => {
    if (!statusConfirm) return;
    try {
      const res = await workspacesApi.update(workspace.id, { status: statusConfirm });
      notify(`Workspace ${statusConfirm.toLowerCase()}.`, "success");
      onChanged(res.workspace);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update workspace status.", "error");
    } finally {
      setStatusConfirm(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await invitationsApi.revoke(revokeTarget.id);
      notify("Invitation revoked.", "success");
      void loadExtra();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revoke invitation.", "error");
    } finally {
      setRevokeTarget(null);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {workspace.name}
            <Badge tone={STATUS_TONE[workspace.status]}>{workspace.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {workspace.provisionedForClient ? `Client: ${workspace.provisionedForClient.name}` : "No linked client"}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {canUpdate && workspace.status === "TRIAL" && (
            <Button variant="primary" onClick={() => setStatusConfirm("ACTIVE")}>
              Activate
            </Button>
          )}
          {canSuspend && workspace.status === "ACTIVE" && (
            <Button variant="danger" onClick={() => setStatusConfirm("SUSPENDED")}>
              <Ban className="w-3.5 h-3.5" /> Suspend
            </Button>
          )}
          {canSuspend && workspace.status === "SUSPENDED" && (
            <Button variant="primary" onClick={() => setStatusConfirm("ACTIVE")}>
              Reactivate
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid sm:grid-cols-2 gap-3 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Timezone</p>
          <p style={{ color: "var(--text-primary)" }}>{workspace.timezone}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Currency</p>
          <p style={{ color: "var(--text-primary)" }}>{workspace.currency}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Locale</p>
          <p style={{ color: "var(--text-primary)" }}>{workspace.locale}</p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Email</p>
          <p style={{ color: "var(--text-primary)" }}>{workspace.email ?? "—"}</p>
        </div>
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Members
        </h3>
        {loadingExtra ? (
          <LoadingState />
        ) : members.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            No members yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-primary)" }}>
                  {m.displayName ?? `${m.firstName} ${m.lastName}`} <span style={{ color: "var(--text-muted)" }}>({m.email})</span>
                </span>
                <Badge tone="info">{m.roleKey}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 py-3 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Invitations
        </h3>
        {canInvite && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Invite administrator
          </Button>
        )}
      </div>
      {invitations.length === 0 ? (
        <p className="px-4 pb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No invitations sent yet.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {invitations.map((inv) => (
            <li key={inv.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p style={{ color: "var(--text-primary)" }}>{inv.email}</p>
                <p style={{ color: "var(--text-muted)" }}>Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={INVITATION_TONE[inv.status]}>{inv.status}</Badge>
                {canRevoke && inv.status === "PENDING" && (
                  <Button variant="danger" onClick={() => setRevokeTarget(inv)}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onSaved={loadExtra} workspaceId={workspace.id} />
      <ConfirmDialog
        open={!!statusConfirm}
        title={`${statusConfirm === "SUSPENDED" ? "Suspend" : "Activate"} workspace`}
        message={`${statusConfirm === "SUSPENDED" ? "Suspend" : "Activate"} "${workspace.name}"?`}
        confirmLabel={statusConfirm === "SUSPENDED" ? "Suspend" : "Activate"}
        destructive={statusConfirm === "SUSPENDED"}
        onConfirm={handleStatusChange}
        onCancel={() => setStatusConfirm(null)}
      />
      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke invitation"
        message={`Revoke the invitation sent to ${revokeTarget?.email}?`}
        confirmLabel="Revoke"
        destructive
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </Card>
  );
};

export const WorkspacesPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<WorkspaceStatusValue | "">("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await workspacesApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setWorkspaces(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((w) => w.id === prev.id) ? res.items.find((w) => w.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Layers className="w-5 h-5" /> Workspaces
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Operational tenants provisioned from CRM clients.
        </p>
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search workspaces…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as WorkspaceStatusValue | "")}>
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
      ) : workspaces.length === 0 ? (
        <Card>
          <EmptyState title="No workspaces found" description="Provision a workspace from a CRM client's detail page." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {workspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelected(w)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === w.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{w.name}</span>
                <Badge tone={STATUS_TONE[w.status]}>{w.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selected && <WorkspaceDetail workspace={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}
    </div>
  );
};
