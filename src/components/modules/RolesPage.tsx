/**
 * Phase 4 §14 — read-only role/permission display. The backend does not
 * implement custom-role CRUD (Phase 3 only built GET /roles — see
 * docs/RBAC_IMPLEMENTATION.md), so this page does not invent role
 * creation/editing the API can't back. Role ASSIGNMENT to a user happens
 * on the Users page, which the real roles.assign-gated endpoint backs.
 */
import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { rolesApi, type ResolvedRole } from "../../lib/api";
import { Card, Badge, LoadingState, ErrorState } from "../ui/ui";

export const RolesPage: React.FC = () => {
  const [roles, setRoles] = useState<ResolvedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rolesApi
      .list()
      .then((res) => setRoles(res.roles))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load roles."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <ShieldCheck className="w-5 h-5" /> Roles
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Platform system roles and their effective permissions.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {role.name}
              </h2>
              <Badge tone={role.key === "SUPER_ADMIN" ? "danger" : "neutral"}>{role.key}</Badge>
            </div>
            <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
              {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
              {role.permissions.slice(0, 30).map((p) => (
                <span key={p} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                  {p}
                </span>
              ))}
              {role.permissions.length > 30 && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  +{role.permissions.length - 30} more
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
