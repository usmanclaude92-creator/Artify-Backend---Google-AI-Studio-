/** Phase 5 §23/§27 — Leads: search/filter/pagination/CRUD, status lifecycle, lead→client conversion. */
import React, { useEffect, useState } from "react";
import { Briefcase, Plus, Search, ArrowRightCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { leadsApi, type Lead, type LeadStatus } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "LOST"];
const STATUS_TONE: Record<LeadStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  NEW: "info",
  CONTACTED: "warning",
  QUALIFIED: "success",
  CONVERTED: "success",
  LOST: "danger",
};

const LeadFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  mode: "create" | "edit";
  lead?: Lead;
}> = ({ open, onClose, onSaved, mode, lead }) => {
  const { notify } = useToast();
  const [companyName, setCompanyName] = useState(lead?.companyName ?? "");
  const [contactName, setContactName] = useState(lead?.contactName ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [source, setSource] = useState(lead?.source ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead && lead.status !== "CONVERTED" ? lead.status : "NEW");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCompanyName(lead?.companyName ?? "");
      setContactName(lead?.contactName ?? "");
      setEmail(lead?.email ?? "");
      setPhone(lead?.phone ?? "");
      setSource(lead?.source ?? "");
      setStatus(lead && lead.status !== "CONVERTED" ? lead.status : "NEW");
      setNotes(lead?.notes ?? "");
      setError(null);
    }
  }, [open, lead]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        await leadsApi.create({ companyName, contactName, email, phone, source, status, notes });
        notify("Lead created.", "success");
      } else if (lead) {
        await leadsApi.update(lead.id, { companyName, contactName, email, phone, source, status, notes });
        notify("Lead updated.", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save lead.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New lead" : `Edit ${lead?.companyName}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Company / lead name">
          <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact name">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Source">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Referral" />
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
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create lead" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ConvertLeadModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; lead?: Lead }> = ({
  open,
  onClose,
  onSaved,
  lead,
}) => {
  const { notify } = useToast();
  const [clientCode, setClientCode] = useState("");
  const [name, setName] = useState(lead?.companyName ?? "");
  const [createContact, setCreateContact] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientCode("");
      setName(lead?.companyName ?? "");
      setCreateContact(true);
      setError(null);
    }
  }, [open, lead]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setError(null);
    setSubmitting(true);
    try {
      await leadsApi.convert(lead.id, { clientCode, name, email: lead.email ?? undefined, phone: lead.phone ?? undefined, createContact });
      notify("Lead converted to client.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not convert lead.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Convert ${lead?.companyName ?? "lead"} to a client`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Client code" hint="A short unique identifier for the new client.">
          <Input required value={clientCode} onChange={(e) => setClientCode(e.target.value)} />
        </Field>
        <Field label="Client name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={createContact} onChange={(e) => setCreateContact(e.target.checked)} />
          Create a primary contact from the lead's contact name
        </label>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Convert
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const LeadsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "leads.create");
  const canUpdate = hasPermission(user?.role.permissions, "leads.update");
  const canDelete = hasPermission(user?.role.permissions, "leads.delete");
  const canConvert = hasPermission(user?.role.permissions, "leads.convert");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; lead?: Lead } | null>(null);
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);

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
      const res = await leadsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setLeads(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await leadsApi.remove(deleteTarget.id);
      notify("Lead deleted.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete lead.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Briefcase className="w-5 h-5" /> Leads
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Track prospective clients through your pipeline.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
            <Plus className="w-4 h-4" /> New lead
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | "")}>
          <option value="">All statuses</option>
          {(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"] as LeadStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : leads.length === 0 ? (
          <EmptyState title="No leads found" description="Create a lead or adjust your filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: "var(--bg-surface-alt)", color: "var(--text-muted)" }}>
                <tr className="uppercase text-[10px] font-bold">
                  <th className="px-4 py-2.5">Company</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Created</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {l.companyName}
                      </p>
                      <p style={{ color: "var(--text-muted)" }}>{l.email}</p>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {l.contactName ?? "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {l.source ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {new Date(l.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      {canUpdate && l.status !== "CONVERTED" && (
                        <Button variant="secondary" onClick={() => setModal({ mode: "edit", lead: l })}>
                          Edit
                        </Button>
                      )}
                      {canConvert && l.status !== "CONVERTED" && (
                        <Button variant="primary" onClick={() => setConvertTarget(l)}>
                          <ArrowRightCircle className="w-3.5 h-3.5" /> Convert
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="danger" onClick={() => setDeleteTarget(l)}>
                          Delete
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

      <LeadFormModal open={!!modal} onClose={() => setModal(null)} onSaved={load} mode={modal?.mode ?? "create"} lead={modal?.lead} />
      <ConvertLeadModal open={!!convertTarget} onClose={() => setConvertTarget(null)} onSaved={load} lead={convertTarget ?? undefined} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete lead"
        message={`Delete the lead "${deleteTarget?.companyName}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
