/** Phase 10 — Invoices: searchable/paginated list + master-detail with line items, issue/void, and payment recording (docs/BILLING_ARCHITECTURE.md). */
import React, { useEffect, useState } from "react";
import { Receipt, Plus, Search, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  invoicesApi,
  clientsApi,
  type Invoice,
  type InvoiceStatusValue,
  type InvoiceItemPayload,
  type PaymentMethodValue,
  type CrmClient,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { formatMoney } from "../../lib/money";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ReasonConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: InvoiceStatusValue[] = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "CANCELLED"];
const STATUS_TONE: Record<InvoiceStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  VOID: "danger",
  CANCELLED: "danger",
};
const METHOD_OPTIONS: PaymentMethodValue[] = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"];

const emptyItem = (): InvoiceItemPayload => ({ description: "", quantity: 1, unitPrice: "", discount: "0" });

const InvoiceFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("OMR");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<InvoiceItemPayload[]>([emptyItem()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientId("");
      setIssueDate("");
      setDueDate("");
      setCurrency("OMR");
      setDiscount("0");
      setTax("0");
      setNotes("");
      setItems([emptyItem()]);
      setError(null);
      void clientsApi.list({ limit: 100 }).then((res) => setClients(res.items));
    }
  }, [open]);

  const updateItem = (index: number, patch: Partial<InvoiceItemPayload>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await invoicesApi.create({ clientId, issueDate, dueDate, currency, discount, tax, notes: notes || undefined, items });
      notify("Invoice created as DRAFT.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create invoice.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New invoice">
      <form onSubmit={handleSubmit} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue date">
            <Input required type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Line items
            </span>
            <Button type="button" variant="secondary" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              <Plus className="w-3.5 h-3.5" /> Add line
            </Button>
          </div>
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-[1fr_60px_90px_90px_28px] gap-2 items-center">
              <Input
                required
                placeholder="Description"
                value={item.description}
                onChange={(e) => updateItem(index, { description: e.target.value })}
              />
              <Input
                required
                type="number"
                min={1}
                placeholder="Qty"
                value={item.quantity}
                onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
              />
              <Input required inputMode="decimal" placeholder="Unit price" value={item.unitPrice} onChange={(e) => updateItem(index, { unitPrice: e.target.value })} />
              <Input inputMode="decimal" placeholder="Discount" value={item.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} />
              <button
                type="button"
                aria-label="Remove line"
                disabled={items.length === 1}
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                style={{ color: "var(--text-muted)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Currency">
            <Input required maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Invoice discount">
            <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
          <Field label="Tax">
            <Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Create draft invoice
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const PaymentFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; invoice: Invoice }> = ({ open, onClose, onSaved, invoice }) => {
  const { notify } = useToast();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<PaymentMethodValue>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setPaymentDate("");
      setMethod("BANK_TRANSFER");
      setReference("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await invoicesApi.recordPayment(invoice.id, { amount, paymentDate, method, reference: reference || undefined });
      notify("Payment recorded.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not record payment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a payment">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Outstanding balance: <strong style={{ color: "var(--text-primary)" }}>{formatMoney(invoice.amountDue, invoice.currency)}</strong>
        </p>
        <Field label="Amount">
          <Input required inputMode="decimal" placeholder="0.000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment date">
            <Input required type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodValue)}>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref, cheque number, etc." />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Record payment
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const InvoiceDetail: React.FC<{ invoice: Invoice; onChanged: () => void }> = ({ invoice, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canIssue = hasPermission(user?.role.permissions, "invoices.issue");
  const canVoid = hasPermission(user?.role.permissions, "invoices.void");
  const canRecordPayment = hasPermission(user?.role.permissions, "payments.create");

  const [voidOpen, setVoidOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
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
            {invoice.invoiceNumber}
            <Badge tone={STATUS_TONE[invoice.effectiveStatus]}>{invoice.effectiveStatus}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Issued {invoice.issueDate.slice(0, 10)} · due {invoice.dueDate.slice(0, 10)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {canIssue && invoice.status === "DRAFT" && (
            <Button variant="primary" disabled={busy} onClick={() => void runAction(() => invoicesApi.issue(invoice.id), "Invoice issued.")}>
              Issue
            </Button>
          )}
          {canRecordPayment && (invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && (
            <Button variant="secondary" disabled={busy} onClick={() => setPaymentOpen(true)}>
              Record payment
            </Button>
          )}
          {canVoid && invoice.status !== "VOID" && invoice.status !== "CANCELLED" && invoice.status !== "PAID" && (
            <Button variant="danger" disabled={busy} onClick={() => setVoidOpen(true)}>
              {invoice.status === "DRAFT" ? "Cancel" : "Void"}
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-4 gap-4 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Subtotal</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(invoice.subtotal, invoice.currency)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Total</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(invoice.total, invoice.currency)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Paid</p>
          <p className="font-semibold" style={{ color: "#059669" }}>
            {formatMoney(invoice.amountPaid, invoice.currency)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Due</p>
          <p className="font-semibold" style={{ color: Number(invoice.amountDue) > 0 ? "#e11d48" : "var(--text-primary)" }}>
            {formatMoney(invoice.amountDue, invoice.currency)}
          </p>
        </div>
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Line items
        </h3>
      </div>
      <ul className="divide-y border-b" style={{ borderColor: "var(--border)" }}>
        {invoice.items.map((item) => (
          <li key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {item.description}
              </p>
              <p style={{ color: "var(--text-muted)" }}>
                {item.quantity} × {formatMoney(item.unitPrice, invoice.currency)}
                {Number(item.discount) > 0 ? ` − ${formatMoney(item.discount, invoice.currency)} discount` : ""}
              </p>
            </div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatMoney(item.lineTotal, invoice.currency)}
            </p>
          </li>
        ))}
      </ul>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Payments
        </h3>
      </div>
      {invoice.payments.length === 0 ? (
        <EmptyState title="No payments recorded yet" />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {invoice.payments.map((p) => (
            <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {p.method} · {p.paymentDate.slice(0, 10)}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{p.reference || "—"}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold" style={{ color: p.status === "REVERSED" ? "#e11d48" : "var(--text-primary)" }}>
                  {formatMoney(p.amount, p.currency)}
                </p>
                <Badge tone={p.status === "REVERSED" ? "danger" : "success"}>{p.status}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReasonConfirmDialog
        open={voidOpen}
        title={invoice.status === "DRAFT" ? "Cancel invoice" : "Void invoice"}
        message="This cannot be undone."
        reasonPlaceholder="Billing error, duplicate, etc."
        confirmLabel={invoice.status === "DRAFT" ? "Cancel invoice" : "Void invoice"}
        onConfirm={(reason) => {
          setVoidOpen(false);
          void runAction(() => invoicesApi.void(invoice.id, reason), "Invoice voided.");
        }}
        onCancel={() => setVoidOpen(false)}
      />

      <PaymentFormModal open={paymentOpen} onClose={() => setPaymentOpen(false)} onSaved={onChanged} invoice={invoice} />
    </Card>
  );
};

export const InvoicesPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "invoices.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<InvoiceStatusValue | "">("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
      const res = await invoicesApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setInvoices(res.items);
      setTotalPages(res.totalPages);
      setSelectedId((prev) => (prev && res.items.some((i) => i.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list response doesn't include items/payments/effectiveStatus (see
  // invoiceRepository.list / invoiceService.listInvoices) — the detail pane
  // always fetches its own full record by id rather than assuming the list
  // row is complete.
  const [selectedDetail, setSelectedDetail] = useState<Invoice | null>(null);
  const loadDetail = React.useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedDetail(null);
      return;
    }
    try {
      const res = await invoicesApi.get(id);
      setSelectedDetail(res.invoice);
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
            <Receipt className="w-5 h-5" /> Invoices
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Client invoices, line items, and payment records.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New invoice
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search invoice number…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatusValue | "")}>
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
      ) : invoices.length === 0 ? (
        <Card>
          <EmptyState title="No invoices found" description="Create an invoice or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {invoices.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelectedId(i.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selectedId === i.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{i.invoiceNumber}</span>
                <Badge tone={STATUS_TONE[i.effectiveStatus]}>{i.effectiveStatus}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selectedDetail && (
            <InvoiceDetail
              invoice={selectedDetail}
              onChanged={() => {
                void load();
                void loadDetail(selectedId);
              }}
            />
          )}
        </div>
      )}

      <InvoiceFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void load()} />
    </div>
  );
};
