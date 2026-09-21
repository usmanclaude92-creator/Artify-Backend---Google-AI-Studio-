/** Phase 4 §16/§17 — organization directory + membership management, all through the Phase 3 org/member APIs. */
import React, { useEffect, useState } from "react";
import { Building2, UserPlus, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { organizationsApi, type Organization, type OrganizationMember } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Badge, Button, LoadingState, ErrorState, EmptyState, Modal, Field, Input, Select, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "USER", "VIEWER"];

const AddMemberModal: React.FC<{ open: boolean; onClose: () => void; organizationId: string; onSaved: () => void }> = ({
  open,
  onClose,
  organizationId,
  onSaved,
}) => {
  const { notify } = useToast();
  const [userId, setUserId] = useState("");
  const [roleKey, setRoleKey] = useState("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await organizationsApi.addMember(organizationId, { userId, roleKey });
      notify("Member added.", "success");
      onSaved();
      onClose();
      setUserId("");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add member.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add member">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="User ID" hint="The internal user id (from the Users page).">
          <Input required value={userId} onChange={(e) => setUserId(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add member
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const OrganizationsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManageMembers = hasPermission(user?.role.permissions, "organizations.manage_members");
  const canAssignRole = hasPermission(user?.role.permissions, "roles.assign");

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(null);

  const loadOrgs = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await organizationsApi.list();
      setOrgs(res.organizations);
      setSelected((prev) => prev ?? res.organizations.find((o) => o.id === user?.organizationId) ?? res.organizations[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organizations.");
    } finally {
      setLoading(false);
    }
  }, [user?.organizationId]);

  const loadMembers = React.useCallback(async (orgId: string) => {
    setMembersLoading(true);
    try {
      const res = await organizationsApi.members(orgId, { limit: 50 });
      setMembers(res.items);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (selected) void loadMembers(selected.id);
  }, [selected, loadMembers]);

  const handleRoleChange = async (member: OrganizationMember, roleKey: string) => {
    if (!selected) return;
    try {
      await organizationsApi.updateMember(selected.id, member.userId, { roleKey });
      notify("Role updated.", "success");
      void loadMembers(selected.id);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update role.", "error");
    }
  };

  const handleRemove = async () => {
    if (!selected || !removeTarget) return;
    try {
      await organizationsApi.removeMember(selected.id, removeTarget.userId);
      notify("Member removed.", "success");
      void loadMembers(selected.id);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not remove member.", "error");
    } finally {
      setRemoveTarget(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Building2 className="w-5 h-5" /> Organizations
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {orgs.length === 1 ? "Your organization." : `${orgs.length} organizations.`}
        </p>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr] gap-4">
        <Card className="p-2 h-fit">
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => setSelected(org)}
              className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5"
              style={selected?.id === org.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
            >
              {org.name}
              <span className="block text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                {org.type} · {org.status}
              </span>
            </button>
          ))}
        </Card>

        {selected && (
          <Card>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {selected.name}
                </h2>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {selected.slug} · {selected.currency}
                </p>
              </div>
              {canManageMembers && (
                <Button variant="primary" onClick={() => setAddOpen(true)}>
                  <UserPlus className="w-3.5 h-3.5" /> Add member
                </Button>
              )}
            </div>

            {membersLoading ? (
              <LoadingState />
            ) : members.length === 0 ? (
              <EmptyState title="No members" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead style={{ background: "var(--bg-surface-alt)", color: "var(--text-muted)" }}>
                    <tr className="uppercase text-[10px] font-bold">
                      <th className="px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Joined</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {members.map((m) => (
                      <tr key={m.userId}>
                        <td className="px-4 py-3">
                          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {m.displayName ?? `${m.firstName} ${m.lastName}`}
                          </p>
                          <p style={{ color: "var(--text-muted)" }}>{m.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          {canAssignRole && m.roleKey !== "SUPER_ADMIN" && m.userId !== user?.id ? (
                            <Select value={m.roleKey} onChange={(e) => void handleRoleChange(m, e.target.value)}>
                              {ROLE_OPTIONS.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Badge tone="info">{m.roleKey}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={m.status === "ACTIVE" ? "success" : "warning"}>{m.status}</Badge>
                        </td>
                        <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                          {new Date(m.joinedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManageMembers && m.userId !== user?.id && (
                            <Button variant="danger" onClick={() => setRemoveTarget(m)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {selected && (
        <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} organizationId={selected.id} onSaved={() => loadMembers(selected.id)} />
      )}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove member"
        message={`Remove ${removeTarget?.displayName ?? removeTarget?.email} from this organization?`}
        confirmLabel="Remove"
        destructive
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
};
