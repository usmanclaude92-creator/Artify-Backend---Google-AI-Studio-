/** Phase 4 §18 — the caller's own active sessions. Never a raw token or token hash rendered. */
import React, { useEffect, useState } from "react";
import { MonitorSmartphone, Laptop, Smartphone, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { authApi, type SessionSummary } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Badge, Button, LoadingState, ErrorState, ConfirmDialog } from "../ui/ui";

function deviceIcon(userAgent: string | null) {
  if (userAgent && /mobile|android|iphone/i.test(userAgent)) return Smartphone;
  return Laptop;
}

export const SecurityPage: React.FC = () => {
  const { logoutAll } = useAuth();
  const { notify } = useToast();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SessionSummary | null>(null);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authApi.sessions();
      setSessions(res.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await authApi.revokeSession(revokeTarget.id);
      notify("Session revoked.", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revoke session.", "error");
    } finally {
      setRevokeTarget(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <MonitorSmartphone className="w-5 h-5" /> Sessions &amp; Security
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {sessions.length} active session{sessions.length === 1 ? "" : "s"} for your account.
          </p>
        </div>
        <Button variant="danger" onClick={() => setConfirmSignOutAll(true)}>
          <LogOut className="w-3.5 h-3.5" /> Sign out everywhere
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {sessions.map((s) => {
          const Icon = deviceIcon(s.userAgent);
          return (
            <Card key={s.id} className="p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--bg-hover)" }}>
                <Icon className="w-4 h-4" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {s.userAgent ? s.userAgent.slice(0, 48) : "Unknown device"}
                  </p>
                  {s.isCurrent && <Badge tone="success">This device</Badge>}
                </div>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {s.ipAddress ?? "Unknown IP"} · created {new Date(s.createdAt).toLocaleString()}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {s.lastUsedAt ? `Last used ${new Date(s.lastUsedAt).toLocaleString()}` : "Not used yet"}
                </p>
              </div>
              {!s.isCurrent && (
                <Button variant="secondary" onClick={() => setRevokeTarget(s)}>
                  Sign out
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Sign out this device"
        message="This session will be revoked immediately."
        confirmLabel="Sign out device"
        destructive
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
      <ConfirmDialog
        open={confirmSignOutAll}
        title="Sign out everywhere"
        message="Every active session, including this one, will be revoked. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={() => {
          setConfirmSignOutAll(false);
          void logoutAll();
        }}
        onCancel={() => setConfirmSignOutAll(false)}
      />
    </div>
  );
};
