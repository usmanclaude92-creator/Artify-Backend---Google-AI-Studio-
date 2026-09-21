/** Phase 5 §21 — CRM dashboard, real counts only via /crm/summary. Cards degrade when a metric's permission is missing. */
import React, { useEffect, useState } from "react";
import { TrendingUp, Briefcase, Building2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { crmApi, type CrmSummary } from "../../lib/api";
import { Card, Badge, LoadingState, ErrorState } from "../ui/ui";

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

export const CrmDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<CrmSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await crmApi.summary();
        if (!cancelled) setSummary(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load CRM dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState label="Loading CRM dashboard…" />;
  if (error) return <ErrorState message={error} />;

  const leads = summary?.leads;
  const clients = summary?.clients;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <TrendingUp className="w-5 h-5" /> CRM Dashboard
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {user?.role.name} · leads and clients for your organization
        </p>
      </div>

      {leads && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Leads
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Briefcase} label="Total" value={leads.total} />
            <StatCard icon={Briefcase} label="New" value={leads.new} />
            <StatCard icon={Briefcase} label="Qualified" value={leads.qualified} />
            <StatCard icon={Briefcase} label="Converted" value={leads.converted} />
            <StatCard icon={Briefcase} label="Lost" value={leads.lost} />
          </div>
        </div>
      )}

      {clients && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Clients
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Building2} label="Total" value={clients.total} />
            <StatCard icon={Building2} label="Prospect" value={clients.prospect} />
            <StatCard icon={Building2} label="Active" value={clients.active} />
            <StatCard icon={Building2} label="Inactive" value={clients.inactive} />
            <StatCard icon={Building2} label="Archived" value={clients.archived} />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {leads && (
          <Card>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Recent leads
              </h2>
            </div>
            {leads.recent.length === 0 ? (
              <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No leads yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {leads.recent.map((l) => (
                  <li key={l.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }} className="font-semibold">
                      {l.companyName}
                    </span>
                    <Badge tone={l.status === "CONVERTED" ? "success" : l.status === "LOST" ? "danger" : "info"}>{l.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {clients && (
          <Card>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Recent clients
              </h2>
            </div>
            {clients.recent.length === 0 ? (
              <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No clients yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {clients.recent.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }} className="font-semibold">
                      {c.name}
                    </span>
                    <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "ARCHIVED" ? "neutral" : "info"}>{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {!leads && !clients && (
        <Card className="p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            You don't have permission to view lead or client metrics.
          </p>
        </Card>
      )}
    </div>
  );
};
