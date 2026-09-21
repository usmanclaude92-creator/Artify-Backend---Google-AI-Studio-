/**
 * Phase 10 §25/§26 — Client Portal: a read-only dashboard + tabs for
 * contracts/subscriptions/invoices/payments, scoped entirely server-side
 * (clientPortalService resolves the caller's own session organization to
 * its Client row — this page never sends or trusts a client id). No
 * create/update/issue/void/reverse controls exist here (docs/CLIENT_PORTAL_ARCHITECTURE.md).
 */
import React, { useEffect, useState } from "react";
import { LayoutDashboard, FileSignature, Repeat, Receipt, Wallet } from "lucide-react";
import { portalApi, type Contract, type Subscription, type Invoice, type Payment, type ClientPortalDashboard, type InvoiceStatusValue } from "../../lib/api";
import { formatMoney } from "../../lib/money";
import { Card, Button, Badge, LoadingState, ErrorState, EmptyState, Pagination } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { useAuth } from "../../context/AuthContext";

type Tab = "dashboard" | "contracts" | "subscriptions" | "invoices" | "payments";

const CONTRACT_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  SUSPENDED: "warning",
  EXPIRED: "danger",
  TERMINATED: "danger",
};
const SUBSCRIPTION_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  TRIALING: "info",
  ACTIVE: "success",
  PAST_DUE: "warning",
  PAUSED: "warning",
  CANCELLED: "danger",
  EXPIRED: "danger",
};
const INVOICE_STATUS_TONE: Record<InvoiceStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  VOID: "danger",
  CANCELLED: "danger",
};

const DashboardTab: React.FC = () => {
  const [dashboard, setDashboard] = useState<ClientPortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .dashboard()
      .then((res) => setDashboard(res.dashboard))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!dashboard) return null;

  const cards: { label: string; value: string }[] = [
    { label: "Active contracts", value: String(dashboard.activeContractCount) },
    { label: "Active subscriptions", value: String(dashboard.activeSubscriptionCount) },
    { label: "Outstanding invoices", value: String(dashboard.outstandingInvoiceCount) },
    { label: "Amount due", value: dashboard.currency ? formatMoney(dashboard.amountDue, dashboard.currency) : dashboard.amountDue },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              {c.label}
            </p>
            <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
              {c.value}
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Recent payments
          </h3>
        </div>
        {dashboard.recentPayments.length === 0 ? (
          <EmptyState title="No payments recorded yet" />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {dashboard.recentPayments.map((p) => (
              <li key={p.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-primary)" }}>
                  {p.method} · {p.paymentDate.slice(0, 10)}
                </span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(p.amount, p.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

const ContractsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Contract[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .contracts({ page, limit: 20 })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load contracts."))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) return <EmptyState title="No contracts" />;

  return (
    <Card>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {items.map((c) => (
          <li key={c.id} className="px-4 py-3 flex items-center justify-between text-xs gap-3">
            <div>
              <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                {c.title}
                <Badge tone={CONTRACT_STATUS_TONE[c.status]}>{c.status}</Badge>
              </p>
              <p style={{ color: "var(--text-muted)" }}>
                {c.contractNumber} · started {c.startDate.slice(0, 10)}
              </p>
            </div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatMoney(c.currentValue, c.currency)}
            </p>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

const SubscriptionsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Subscription[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .subscriptions({ page, limit: 20 })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load subscriptions."))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) return <EmptyState title="No subscriptions" />;

  return (
    <Card>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {items.map((s) => (
          <li key={s.id} className="px-4 py-3 flex items-center justify-between text-xs gap-3">
            <div>
              <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                {s.subscriptionNumber}
                <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status]}>{s.status}</Badge>
              </p>
              <p style={{ color: "var(--text-muted)" }}>{s.billingCycle}</p>
            </div>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatMoney(s.price, s.currency)}
            </p>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

const InvoicesTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Invoice[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .invoices({ page, limit: 20 })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load invoices."))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) return <EmptyState title="No invoices" />;

  return (
    <Card>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {items.map((i) => (
          <li key={i.id} className="px-4 py-3 flex items-center justify-between text-xs gap-3">
            <div>
              <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                {i.invoiceNumber}
                <Badge tone={INVOICE_STATUS_TONE[i.effectiveStatus]}>{i.effectiveStatus}</Badge>
              </p>
              <p style={{ color: "var(--text-muted)" }}>
                Issued {i.issueDate.slice(0, 10)} · due {i.dueDate.slice(0, 10)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {formatMoney(i.total, i.currency)}
              </p>
              {Number(i.amountDue) > 0 && (
                <p style={{ color: "#e11d48" }}>{formatMoney(i.amountDue, i.currency)} due</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

const PaymentsTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Payment[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .payments({ page, limit: 20 })
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payments."))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) return <EmptyState title="No payments" />;

  return (
    <Card>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {items.map((p) => (
          <li key={p.id} className="px-4 py-3 flex items-center justify-between text-xs gap-3">
            <div>
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {p.method} · {p.paymentDate.slice(0, 10)}
              </p>
              <p style={{ color: "var(--text-muted)" }}>{p.reference || "No reference"}</p>
            </div>
            <p className="font-semibold" style={{ color: p.status === "REVERSED" ? "#e11d48" : "var(--text-primary)" }}>
              {formatMoney(p.amount, p.currency)}
            </p>
          </li>
        ))}
      </ul>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </Card>
  );
};

export const ClientPortalPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");

  const allTabs: { id: Tab; label: string; icon: typeof LayoutDashboard; permission: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "portal.dashboard.read" },
    { id: "contracts", label: "Contracts", icon: FileSignature, permission: "portal.contracts.read" },
    { id: "subscriptions", label: "Subscriptions", icon: Repeat, permission: "portal.subscriptions.read" },
    { id: "invoices", label: "Invoices", icon: Receipt, permission: "portal.invoices.read" },
    { id: "payments", label: "Payments", icon: Wallet, permission: "portal.payments.read" },
  ];
  const tabs = allTabs.filter((t) => hasPermission(user?.role.permissions, t.permission));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Your Account
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          A read-only view of your contracts, subscriptions, invoices, and payments.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <Button key={t.id} variant={tab === t.id ? "primary" : "secondary"} onClick={() => setTab(t.id)}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </Button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "contracts" && <ContractsTab />}
      {tab === "subscriptions" && <SubscriptionsTab />}
      {tab === "invoices" && <InvoicesTab />}
      {tab === "payments" && <PaymentsTab />}
    </div>
  );
};
