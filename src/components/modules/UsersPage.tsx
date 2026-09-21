/** Phase 4 §13 — real data, permission-scoped actions, no password hashes/tokens ever rendered. */
import React, { useEffect, useState } from "react";
import { Users as UsersIcon, Plus, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { usersApi, type SanitizedUser } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, Select } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "USER", "VIEWER"];
const STATUS_TONE: Record<string, "success" | "warning" | "danger"> = { ACTIVE: "success", INVITED: "warning", DISABLED: "danger" };

const UserFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: "create" | "edit";
  user?: SanitizedUser;
  canAssignRole: boolean;
}> = ({ open, onClose, onSaved, mode, user, canAssignRole }) => {
  const { notify } = useToast();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [roleKey, setRoleKey] = useState(user?.role.key && user.role.key !== "SUPER_ADMIN" ? user.role.key : "VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? "");
      setPassword("");
      setFirstName(user?.firstName ?? "");
      setLastName(user?.lastName ?? "");
      setRoleKey(user?.role.key && user.role.key !== "SUPER_ADMIN" ? user.role.key : "VIEWER");
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        await usersApi.create({ email, password, firstName, lastName, roleKey });
        notify("User created.", "success");
      } else if (user) {
        const payload: Parameters<typeof usersApi.update>[1] = { firstName, lastName };
        if (canAssignRole && roleKey !== user.role.key) payload.roleKey = roleKey;
        await usersApi.update(user.id, payload);
        notify("User updated.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save user.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "Invite user" : `Edit ${user?.displayName ?? user?.email}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" required disabled={mode === "edit"} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode === "create" && (
          <Field label="Initial password" hint="At least 10 characters. Share with the user out-of-band.">
            <Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {canAssignRole && (mode === "create" || user?.id !== undefined) && (
          <Field label="Role">
            <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)} disabled={mode === "edit" && user?.role.key === "SUPER_ADMIN"}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create user" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(currentUser?.role.permissions, "users.create");
  const canUpdate = hasPermission(currentUser?.role.permissions, "users.update");
  const canAssignRole = hasPermission(currentUser?.role.permissions, "roles.assign");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<SanitizedUser[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; user?: SanitizedUser } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await usersApi.list({ page, limit: 20 });
      setUsers(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleStatus = async (u: SanitizedUser) => {
    try {
      await usersApi.update(u.id, { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
      notify(u.status === "ACTIVE" ? "User deactivated." : "User activated.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update user.", "error");
    }
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return !q || u.email.toLowerCase().includes(q) || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <UsersIcon className="w-5 h-5" /> Users
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Manage accounts in your organization.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
            <Plus className="w-4 h-4" /> Invite user
          </Button>
        )}
      </div>

      <Card className="p-3">
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search this page…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No users found" description="Invite a user or adjust your search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: "var(--bg-surface-alt)", color: "var(--text-muted)" }}>
                <tr className="uppercase text-[10px] font-bold">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Last login</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {u.displayName ?? `${u.firstName} ${u.lastName}`}
                        {u.id === currentUser?.id && (
                          <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--text-muted)" }}>
                            (you)
                          </span>
                        )}
                      </p>
                      <p style={{ color: "var(--text-muted)" }}>{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="info">{u.role.key}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {canUpdate && (
                        <Button variant="secondary" onClick={() => setModal({ mode: "edit", user: u })}>
                          Edit
                        </Button>
                      )}
                      {canUpdate && u.id !== currentUser?.id && (
                        <Button variant={u.status === "ACTIVE" ? "danger" : "primary"} onClick={() => void toggleStatus(u)}>
                          {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <UserFormModal
        open={!!modal}
        onClose={() => setModal(null)}
        onSaved={load}
        mode={modal?.mode ?? "create"}
        user={modal?.user}
        canAssignRole={canAssignRole}
      />
    </div>
  );
};
