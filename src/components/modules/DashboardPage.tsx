/** Phase 4 §20 — real data only, no fabricated metrics. Cards degrade gracefully when the user lacks the permission a metric needs. */
import React, { useEffect, useState } from "react";
import { Users, Building2, MonitorSmartphone, ScrollText } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { organizationsApi, auditLogsApi, type AuditLogEntry } from "../../lib/api";
import { Card, LoadingState, ErrorState } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode }> = ({ icon: Icon, label, value }) => (
  <Card className="p-4 flex items-center gap-3">
    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)" }}>
      <Icon className="w-4.5 h-4.5" style={{ color: "var(--accent)" }} />
    </div>
    <div>
      <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  </Card>
);

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const canReadOrg = hasPermission(user?.role.permissions, "organizations.read");
  const canReadAudit = hasPermission(user?.role.permissions, "audit.read");

  const [summary, setSummary] = useState<{ memberCount: number; activeSessionCount: number } | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [summaryRes, auditRes] = await Promise.all([
          canReadOrg && user ? organizationsApi.summary(user.organizationId) : Promise.resolve(null),
          canReadAudit ? auditLogsApi.list({ page: 1, limit: 5 }) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (summaryRes) setSummary(summaryRes);
        if (auditRes) setRecentAudit(auditRes.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canReadOrg, canReadAudit, user]);

  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Welcome back, {user?.firstName}
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {user?.role.name} · signed in to your current organization
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="Your organizations" value={1} />
        {summary && <StatCard icon={Users} label="Members" value={summary.memberCount} />}
        {summary && <StatCard icon={MonitorSmartphone} label="Active sessions" value={summary.activeSessionCount} />}
        {canReadAudit && <StatCard icon={ScrollText} label="Recent audit events" value={recentAudit.length} />}
      </div>

      {canReadAudit && (
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Recent activity
            </h2>
          </div>
          {recentAudit.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No audit activity yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {recentAudit.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span style={{ color: "var(--text-primary)" }}>
                    <span className="font-semibold">{entry.actorName ?? "System"}</span> · {entry.action}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(entry.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};
