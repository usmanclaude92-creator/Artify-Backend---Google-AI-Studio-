/** Phase 10 — Contracts: searchable/paginated list + master-detail with lifecycle actions (activate/suspend/terminate) and variation history (docs/COMMERCIAL_ARCHITECTURE.md). */
import React, { useEffect, useState } from "react";
import { FileSignature, Plus, Search, History } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { contractsApi, clientsApi, type Contract, type ContractStatusValue, type CrmClient } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { formatMoney } from "../../lib/money";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ReasonConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: ContractStatusValue[] = ["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"];
const STATUS_TONE: Record<ContractStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  SUSPENDED: "warning",
  EXPIRED: "danger",
  TERMINATED: "danger",
};

const ContractFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [currency, setCurrency] = useState("OMR");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientId("");
      setTitle("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setContractValue("");
      setCurrency("OMR");
      setError(null);
      void clientsApi.list({ limit: 100 }).then((res) => setClients(res.items));
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await contractsApi.create({ clientId, title, description: description || undefined, startDate, endDate: endDate || undefined, contractValue, currency });
      notify("Contract created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create contract.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New contract">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Client">
          <Select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date (optional)">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contract value">
            <Input required inputMode="decimal" placeholder="0.000" value={contractValue} onChange={(e) => setContractValue(e.target.value)} />
          </Field>
          <Field label="Currency">
            <Input required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create contract
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const VariationFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; contractId: string }> = ({ open, onClose, onSaved, contractId }) => {
  const { notify } = useToast();
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setEffectiveDate("");
      setReason("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await contractsApi.addVariation(contractId, { amount, effectiveDate, reason });
      notify("Variation recorded.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not record variation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a contract variation">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Amount" hint="Positive to increase the contract's value, negative to reduce it.">
          <Input required inputMode="decimal" placeholder="e.g. 500.000 or -200.000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Effective date">
          <Input required type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Record variation
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ContractDetail: React.FC<{ contract: Contract; onChanged: () => void }> = ({ contract, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canActivate = hasPermission(user?.role.permissions, "contracts.activate");
  const canSuspend = hasPermission(user?.role.permissions, "contracts.suspend");
  const canTerminate = hasPermission(user?.role.permissions, "contracts.terminate");
  const canAddVariation = hasPermission(user?.role.permissions, "contracts.variations.create");

  const [variationOpen, setVariationOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const runAction = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await fn();
      notify(successMessage, "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {contract.title}
            <Badge tone={STATUS_TONE[contract.status]}>{contract.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {contract.contractNumber} · started {contract.startDate.slice(0, 10)}
            {contract.endDate ? ` · ends ${contract.endDate.slice(0, 10)}` : ""}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {canActivate && (contract.status === "DRAFT" || contract.status === "SUSPENDED") && (
            <Button variant="primary" disabled={busy} onClick={() => void runAction(() => contractsApi.activate(contract.id), "Contract activated.")}>
              Activate
            </Button>
          )}
          {canSuspend && contract.status === "ACTIVE" && (
            <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => contractsApi.suspend(contract.id), "Contract suspended.")}>
              Suspend
            </Button>
          )}
          {canTerminate && contract.status !== "TERMINATED" && contract.status !== "EXPIRED" && (
            <Button variant="danger" disabled={busy} onClick={() => setTerminateOpen(true)}>
              Terminate
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Original value</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(contract.contractValue, contract.currency)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Current value</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(contract.currentValue, contract.currency)}
          </p>
        </div>
        {contract.description && (
          <p className="col-span-2" style={{ color: "var(--text-secondary)" }}>
            {contract.description}
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <History className="w-3.5 h-3.5" /> Variation history
        </h3>
        {canAddVariation && contract.status !== "TERMINATED" && contract.status !== "EXPIRED" && (
          <Button variant="primary" onClick={() => setVariationOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add variation
          </Button>
        )}
      </div>

      {contract.variations.length === 0 ? (
        <EmptyState title="No variations yet" description="This contract's value has never changed since it was created." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {contract.variations.map((v) => (
            <li key={v.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  #{v.variationNumber} · {v.reason}
                </p>
                <p style={{ color: "var(--text-muted)" }}>Effective {v.effectiveDate.slice(0, 10)}</p>
              </div>
              <p className="font-semibold" style={{ color: Number(v.amount) >= 0 ? "#059669" : "#e11d48" }}>
                {Number(v.amount) >= 0 ? "+" : ""}
                {formatMoney(v.amount, contract.currency)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <VariationFormModal open={variationOpen} onClose={() => setVariationOpen(false)} onSaved={onChanged} contractId={contract.id} />
      <ReasonConfirmDialog
        open={terminateOpen}
        title="Terminate contract"
        message="Terminating is final — the contract cannot be reactivated afterward."
        reasonLabel="Termination reason"
        reasonPlaceholder="Client churned, contract completed, etc."
        confirmLabel="Terminate"
        onConfirm={(reason) => {
          setTerminateOpen(false);
          void runAction(() => contractsApi.terminate(contract.id, reason), "Contract terminated.");
        }}
        onCancel={() => setTerminateOpen(false)}
      />
    </Card>
  );
};

export const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "contracts.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ContractStatusValue | "">("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, status]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await contractsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setContracts(res.items);
      setTotalPages(res.totalPages);
      setSelectedId((prev) => (prev && res.items.some((c) => c.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contracts.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list response doesn't include variations/currentValue (see
  // contractRepository.list) — the detail pane always fetches its own full
  // record by id rather than assuming the list row is complete.
  const [selectedDetail, setSelectedDetail] = useState<Contract | null>(null);
  const loadDetail = React.useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedDetail(null);
      return;
    }
    try {
      const res = await contractsApi.get(id);
      setSelectedDetail(res.contract);
    } catch {
      setSelectedDetail(null);
    }
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <FileSignature className="w-5 h-5" /> Contracts
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Client contracts, their lifecycle, and value variation history.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New contract
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search contracts…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ContractStatusValue | "")}>
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
      ) : contracts.length === 0 ? (
        <Card>
          <EmptyState title="No contracts found" description="Create a contract or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {contracts.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selectedId === c.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{c.title}</span>
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selectedDetail && (
            <ContractDetail
              contract={selectedDetail}
              onChanged={() => {
                void load();
                void loadDetail(selectedId);
              }}
            />
          )}
        </div>
      )}

      <ContractFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void load()} />
    </div>
  );
};
