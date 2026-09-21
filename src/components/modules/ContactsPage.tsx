/** Phase 5 §22 — org-wide contact directory: search/filter-by-client/pagination, edit, remove. */
import React, { useEffect, useState } from "react";
import { Contact2, Search, Star, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { contactsApi, clientsApi, type CrmContact, type CrmClient } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const ContactEditModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; contact?: CrmContact }> = ({
  open,
  onClose,
  onSaved,
  contact,
}) => {
  const { notify } = useToast();
  const [firstName, setFirstName] = useState(contact?.firstName ?? "");
  const [lastName, setLastName] = useState(contact?.lastName ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName(contact?.firstName ?? "");
      setLastName(contact?.lastName ?? "");
      setEmail(contact?.email ?? "");
      setPhone(contact?.phone ?? "");
      setJobTitle(contact?.jobTitle ?? "");
      setError(null);
    }
  }, [open, contact]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contact) return;
    setError(null);
    setSubmitting(true);
    try {
      await contactsApi.update(contact.id, { firstName, lastName, email, phone, jobTitle });
      notify("Contact updated.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update contact.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${contact?.firstName} ${contact?.lastName}`}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Job title">
          <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const ContactsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "contacts.update");
  const canDelete = hasPermission(user?.role.permissions, "contacts.delete");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientOptions, setClientOptions] = useState<CrmClient[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CrmContact | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CrmContact | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, clientId]);

  useEffect(() => {
    if (!hasPermission(user?.role.permissions, "clients.read")) return;
    clientsApi
      .list({ limit: 100 })
      .then((res) => setClientOptions(res.items))
      .catch(() => setClientOptions([]));
  }, [user?.role.permissions]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await contactsApi.list({ page, limit: 20, search: debouncedSearch || undefined, clientId: clientId || undefined });
      setContacts(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contacts.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMakePrimary = async (contact: CrmContact) => {
    try {
      await contactsApi.update(contact.id, { isPrimary: true });
      notify("Primary contact updated.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update contact.", "error");
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await contactsApi.remove(removeTarget.id);
      notify("Contact removed.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not remove contact.", "error");
    } finally {
      setRemoveTarget(null);
    }
  };

  const clientName = (id: string | null) => (id ? clientOptions.find((c) => c.id === id)?.name ?? "—" : "—");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Contact2 className="w-5 h-5" /> Contacts
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          All contacts across your clients.
        </p>
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search contacts…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {clientOptions.length > 0 && (
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : contacts.length === 0 ? (
          <EmptyState title="No contacts found" description="Add contacts from a client's detail page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: "var(--bg-surface-alt)", color: "var(--text-muted)" }}>
                <tr className="uppercase text-[10px] font-bold">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Job title</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                        {c.firstName} {c.lastName}
                        {c.isPrimary && <Badge tone="success">Primary</Badge>}
                      </p>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {clientName(c.clientId)}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {c.jobTitle ?? "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {c.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      {canUpdate && !c.isPrimary && (
                        <Button variant="secondary" onClick={() => void handleMakePrimary(c)}>
                          <Star className="w-3 h-3" /> Primary
                        </Button>
                      )}
                      {canUpdate && (
                        <Button variant="secondary" onClick={() => setEditTarget(c)}>
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="danger" onClick={() => setRemoveTarget(c)}>
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
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <ContactEditModal open={!!editTarget} onClose={() => setEditTarget(null)} onSaved={load} contact={editTarget ?? undefined} />
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove contact"
        message={`Remove ${removeTarget?.firstName} ${removeTarget?.lastName}?`}
        confirmLabel="Remove"
        destructive
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
};
