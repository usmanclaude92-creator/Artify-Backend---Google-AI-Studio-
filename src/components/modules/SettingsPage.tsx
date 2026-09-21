/** Phase 4 §21 — only what the backend genuinely supports (Phase 2's system_settings table via Phase 4's /settings API). No decorative editable fields. */
import React, { useEffect, useState } from "react";
import { Settings as SettingsIcon, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { settingsApi, type SystemSetting } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, LoadingState, ErrorState, EmptyState, Modal, Field } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canManage = hasPermission(user?.role.permissions, "settings.manage");

  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsApi.list();
      setSettings(res.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEdit = async (key: string) => {
    try {
      await settingsApi.update(key, editValue, "STRING");
      notify("Setting updated.", "success");
      setEditingKey(null);
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update setting.", "error");
    }
  };

  const addSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await settingsApi.update(newKey, newValue, "STRING");
      notify("Setting created.", "success");
      setAddOpen(false);
      setNewKey("");
      setNewValue("");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not create setting.", "error");
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <SettingsIcon className="w-5 h-5" /> Settings
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Organization configuration.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add setting
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {settings.length === 0 ? (
          <EmptyState title="No settings configured" description={canManage ? "Add your first setting." : "No settings have been configured yet."} />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {settings.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                    {s.key}
                  </p>
                  {s.description && (
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {s.description}
                    </p>
                  )}
                </div>
                {editingKey === s.key ? (
                  <div className="flex items-center gap-2">
                    <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-40" />
                    <Button variant="primary" onClick={() => void saveEdit(s.key)}>
                      Save
                    </Button>
                    <Button variant="secondary" onClick={() => setEditingKey(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <code className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {typeof s.value === "string" ? s.value : JSON.stringify(s.value)}
                    </code>
                    {canManage && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingKey(s.key);
                          setEditValue(typeof s.value === "string" ? s.value : JSON.stringify(s.value));
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add setting">
        <form onSubmit={addSetting} className="space-y-3">
          <Field label="Key" hint="Dot-namespaced, e.g. branding.display_name">
            <Input required value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          </Field>
          <Field label="Value">
            <Input required value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </Field>
          <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
