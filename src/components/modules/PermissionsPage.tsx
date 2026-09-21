/** Phase 4 §15 — read-only permission catalog, grouped by module. Backend-controlled; nothing here invents a permission the API doesn't know about. */
import React, { useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import { permissionsApi, type Permission } from "../../lib/api";
import { Card, LoadingState, ErrorState } from "../ui/ui";

export const PermissionsPage: React.FC = () => {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    permissionsApi
      .list()
      .then((res) => setPermissions(res.permissions))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load permissions."))
      .finally(() => setLoading(false));
  }, []);

  const byModule = useMemo(() => {
    const groups: Record<string, Permission[]> = {};
    for (const p of permissions) {
      (groups[p.module] ??= []).push(p);
    }
    return groups;
  }, [permissions]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <KeyRound className="w-5 h-5" /> Permissions
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Full permission catalog ({permissions.length} total), backend-controlled.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.entries(byModule) as [string, Permission[]][]).map(([module, perms]) => (
          <Card key={module} className="p-4">
            <h2 className="text-xs font-bold uppercase mb-2" style={{ color: "var(--accent)" }}>
              {module}
            </h2>
            <ul className="space-y-1.5">
              {perms.map((p) => (
                <li key={p.id}>
                  <p className="text-xs font-mono" style={{ color: "var(--text-primary)" }}>
                    {p.key}
                  </p>
                  {p.description && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {p.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
};
