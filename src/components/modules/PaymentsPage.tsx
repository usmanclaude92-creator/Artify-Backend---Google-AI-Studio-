/** Phase 10 — Payments: searchable/paginated list with reversal (docs/BILLING_ARCHITECTURE.md). Recording a payment happens from an invoice's detail view (InvoicesPage.tsx). */
import React, { useEffect, useState } from "react";
import { Wallet, Search, Undo2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { paymentsApi, type Payment, type PaymentStatusValue, type PaymentMethodValue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { formatMoney } from "../../lib/money";
import { Card, Button, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, ReasonConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: PaymentStatusValue[] = ["PENDING", "COMPLETED", "FAILED", "REVERSED"];
const METHOD_OPTIONS: PaymentMethodValue[] = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"];
const STATUS_TONE: Record<PaymentStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  REVERSED: "danger",
};

export const PaymentsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canReverse = hasPermission(user?.role.permissions, "payments.reverse");

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PaymentStatusValue | "">("");
  const [method, setMethod] = useState<PaymentMethodValue | "">("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<Payment | null>(null);

  useEffect(() => setPage(1), [status, method]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await paymentsApi.list({ page, limit: 20, status: status || undefined, method: method || undefined, sort: "paymentDate", order: "desc" });
      setPayments(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }, [page, status, method]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReverse = async (reason: string) => {
    if (!reverseTarget) return;
    try {
      await paymentsApi.reverse(reverseTarget.id, reason);
      notify("Payment reversed.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reverse payment.", "error");
    } finally {
      setReverseTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Wallet className="w-5 h-5" /> Payments
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Every payment recorded against an invoice, and its reversal history.
        </p>
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <Select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodValue | "")}>
          <option value="">All methods</option>
          {METHOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : payments.length === 0 ? (
        <Card>
          <EmptyState title="No payments found" description="Adjust your filters, or record a payment from an invoice's detail view." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {payments.map((p) => (
              <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                    {p.method} · {p.paymentDate.slice(0, 10)}
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{p.reference || "No reference"}</p>
                  {p.reversalReason && <p style={{ color: "var(--text-muted)" }}>Reversed: {p.reversalReason}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="font-semibold text-right" style={{ color: p.status === "REVERSED" ? "#e11d48" : "var(--text-primary)" }}>
                    {formatMoney(p.amount, p.currency)}
                  </p>
                  {canReverse && p.status === "COMPLETED" && (
                    <Button variant="danger" onClick={() => setReverseTarget(p)}>
                      <Undo2 className="w-3.5 h-3.5" /> Reverse
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </Card>
      )}

      <ReasonConfirmDialog
        open={!!reverseTarget}
        title="Reverse payment"
        message="This cannot be undone. The payment record is preserved but no longer counts toward the invoice's paid amount."
        reasonLabel="Reversal reason"
        reasonPlaceholder="Bounced cheque, duplicate entry, etc."
        confirmLabel="Reverse payment"
        onConfirm={(reason) => void handleReverse(reason)}
        onCancel={() => setReverseTarget(null)}
      />
    </div>
  );
};
