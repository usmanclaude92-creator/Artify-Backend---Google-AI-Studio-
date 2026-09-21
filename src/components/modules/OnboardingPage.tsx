/** Phase 6 §27 — onboarding queue: real records only, search/filter/pagination, read-only detail with checklist. Mutating actions live on the CRM Client detail page (§28). */
import React, { useEffect, useState } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { onboardingApi, type Onboarding, type OnboardingStatusValue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const STATUS_OPTIONS: OnboardingStatusValue[] = ["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
const STATUS_TONE: Record<OnboardingStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "warning",
  READY: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};

const OnboardingDetailModal: React.FC<{ open: boolean; onClose: () => void; onboarding: Onboarding | null; onChanged: () => void }> = ({
  open,
  onClose,
  onboarding,
  onChanged,
}) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canComplete = hasPermission(user?.role.permissions, "onboarding.complete");
  const [submitting, setSubmitting] = useState(false);

  if (!onboarding) return null;

  const handleComplete = async () => {
    setSubmitting(true);
    try {
      await onboardingApi.complete(onboarding.id);
      notify("Onboarding completed.", "success");
      onChanged();
      onClose();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not complete onboarding.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Onboarding — ${onboarding.client?.name ?? onboarding.clientId}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[onboarding.status]}>{onboarding.status}</Badge>
          {onboarding.currentStep && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Current step: {onboarding.currentStep}
            </span>
          )}
        </div>
        <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)" }}>
          {onboarding.checklist.map((item) => (
            <li key={item.key} className="px-3 py-2 flex items-center justify-between text-xs">
              <span style={{ color: "var(--text-primary)" }}>{item.label}</span>
              <Badge tone={item.completed ? "success" : "neutral"}>{item.completed ? "Done" : "Pending"}</Badge>
            </li>
          ))}
        </ul>
        {canComplete && onboarding.status === "READY" && (
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
            <Button variant="primary" disabled={submitting} onClick={handleComplete}>
              Complete onboarding
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export const OnboardingPage: React.FC = () => {
  const { path } = useRouter();
  const isPendingView = path === "/onboarding/pending";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<OnboardingStatusValue | "">(isPendingView ? "IN_PROGRESS" : "");
  const [rows, setRows] = useState<Onboarding[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Onboarding | null>(null);

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
      const res = await onboardingApi.list({ page, limit: 20, search: debouncedSearch || undefined, status: status || undefined });
      setRows(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load onboarding queue.");
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
          <ClipboardCheck className="w-5 h-5" /> {isPendingView ? "Pending Onboarding" : "Onboarding Overview"}
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Client onboarding progress, from CRM client to active workspace.
        </p>
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search by client…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as OnboardingStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="No onboarding records" description="Start onboarding from a CRM client's detail page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: "var(--bg-surface-alt)", color: "var(--text-muted)" }}>
                <tr className="uppercase text-[10px] font-bold">
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Onboarding</th>
                  <th className="px-4 py-2.5">Workspace</th>
                  <th className="px-4 py-2.5">Current step</th>
                  <th className="px-4 py-2.5">Started</th>
                  <th className="px-4 py-2.5">Last activity</th>
                  <th className="px-4 py-2.5">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer" onClick={() => setDetail(row)}>
                    <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                      {row.client?.name ?? row.clientId}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {row.client?.workspaceOrganization?.status ?? "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                      {row.currentStep ?? "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {row.startedAt ? new Date(row.startedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                      {row.completedAt ? new Date(row.completedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>

      <OnboardingDetailModal open={!!detail} onClose={() => setDetail(null)} onboarding={detail} onChanged={load} />
    </div>
  );
};
