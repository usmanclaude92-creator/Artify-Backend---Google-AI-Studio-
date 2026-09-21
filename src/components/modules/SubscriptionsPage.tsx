/** Phase 10 — Subscriptions: searchable/paginated list + master-detail with lifecycle actions (activate/pause/cancel) (docs/BILLING_ARCHITECTURE.md). */
import React, { useEffect, useState } from "react";
import { Repeat, Plus, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { subscriptionsApi, clientsApi, productsApi, type Subscription, type SubscriptionStatusValue, type BillingCycleValue, type CrmClient, type CatalogProduct } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { formatMoney } from "../../lib/money";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ReasonConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: SubscriptionStatusValue[] = ["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"];
const CYCLE_OPTIONS: BillingCycleValue[] = ["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"];
const STATUS_TONE: Record<SubscriptionStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  TRIALING: "info",
  ACTIVE: "success",
  PAST_DUE: "warning",
  PAUSED: "warning",
  CANCELLED: "danger",
  EXPIRED: "danger",
};

const SubscriptionFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void }> = ({ open, onClose, onSaved }) => {
  const { notify } = useToast();
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [clientId, setClientId] = useState("");
  const [productId, setProductId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycleValue>("MONTHLY");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("OMR");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setClientId("");
      setProductId("");
      setStartDate("");
      setBillingCycle("MONTHLY");
      setPrice("");
      setCurrency("OMR");
      setError(null);
      void clientsApi.list({ limit: 100 }).then((res) => setClients(res.items));
      void productsApi.list({ limit: 100, status: "ACTIVE" }).then((res) => setProducts(res.items));
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await subscriptionsApi.create({ clientId, productId, startDate, billingCycle, price, currency });
      notify("Subscription created.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create subscription.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New subscription">
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
        <Field label="Product">
          <Select required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Billing cycle">
            <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as BillingCycleValue)}>
              {CYCLE_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price">
            <Input required inputMode="decimal" placeholder="0.000" value={price} onChange={(e) => setPrice(e.target.value)} />
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
            Create subscription
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const SubscriptionDetail: React.FC<{ subscription: Subscription; onChanged: () => void }> = ({ subscription, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canActivate = hasPermission(user?.role.permissions, "subscriptions.activate");
  const canPause = hasPermission(user?.role.permissions, "subscriptions.pause");
  const canCancel = hasPermission(user?.role.permissions, "subscriptions.cancel");

  const [cancelOpen, setCancelOpen] = useState(false);
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

  const terminalStatus = subscription.status === "CANCELLED" || subscription.status === "EXPIRED";

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {subscription.subscriptionNumber}
            <Badge tone={STATUS_TONE[subscription.status]}>{subscription.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {subscription.billingCycle} · started {subscription.startDate.slice(0, 10)}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {canActivate && !terminalStatus && subscription.status !== "ACTIVE" && (
            <Button variant="primary" disabled={busy} onClick={() => void runAction(() => subscriptionsApi.activate(subscription.id), "Subscription activated.")}>
              Activate
            </Button>
          )}
          {canPause && (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") && (
            <Button variant="secondary" disabled={busy} onClick={() => void runAction(() => subscriptionsApi.pause(subscription.id), "Subscription paused.")}>
              Pause
            </Button>
          )}
          {canCancel && !terminalStatus && (
            <Button variant="danger" disabled={busy} onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 gap-4 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Price</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMoney(subscription.price, subscription.currency)} × {subscription.quantity}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-muted)" }}>Renewal date</p>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {subscription.renewalDate ? subscription.renewalDate.slice(0, 10) : "—"}
          </p>
        </div>
        {subscription.cancellationReason && (
          <p className="col-span-2" style={{ color: "var(--text-secondary)" }}>
            Cancelled: {subscription.cancellationReason}
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Line items
        </h3>
      </div>
      {subscription.items.length === 0 ? (
        <EmptyState title="No line items" />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {subscription.items.map((item) => (
            <li key={item.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {item.description}
                </p>
                <p style={{ color: "var(--text-muted)" }}>Qty {item.quantity}</p>
              </div>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {formatMoney(item.unitPrice, item.currency)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <ReasonConfirmDialog
        open={cancelOpen}
        title="Cancel subscription"
        message="Cancelling is final for this subscription."
        reasonLabel="Cancellation reason"
        reasonPlaceholder="Client requested, non-renewal, etc."
        confirmLabel="Cancel subscription"
        onConfirm={(reason) => {
          setCancelOpen(false);
          void runAction(() => subscriptionsApi.cancel(subscription.id, reason), "Subscription cancelled.");
        }}
        onCancel={() => setCancelOpen(false)}
      />
    </Card>
  );
};

export const SubscriptionsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "subscriptions.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<SubscriptionStatusValue | "">("");
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
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
      const res = await subscriptionsApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setSubscriptions(res.items);
      setTotalPages(res.totalPages);
      setSelectedId((prev) => (prev && res.items.some((s) => s.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list response doesn't include items (see subscriptionRepository.list)
  // — the detail pane always fetches its own full record by id rather than
  // assuming the list row is complete.
  const [selectedDetail, setSelectedDetail] = useState<Subscription | null>(null);
  const loadDetail = React.useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedDetail(null);
      return;
    }
    try {
      const res = await subscriptionsApi.get(id);
      setSelectedDetail(res.subscription);
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
            <Repeat className="w-5 h-5" /> Subscriptions
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Recurring client subscriptions and their lifecycle.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New subscription
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search subscription number…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatusValue | "")}>
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
      ) : subscriptions.length === 0 ? (
        <Card>
          <EmptyState title="No subscriptions found" description="Create a subscription or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {subscriptions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selectedId === s.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{s.subscriptionNumber}</span>
                <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selectedDetail && (
            <SubscriptionDetail
              subscription={selectedDetail}
              onChanged={() => {
                void load();
                void loadDetail(selectedId);
              }}
            />
          )}
        </div>
      )}

      <SubscriptionFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => void load()} />
    </div>
  );
};
