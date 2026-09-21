/** Phase 4 §10 — confirm-reset UI. Token read from the URL query string per the backend contract (POST /auth/password-reset/confirm). */
import React, { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { authApi } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useRouter } from "../../lib/router";
import { Button, Input, Field } from "../ui/ui";

export const ResetPasswordPage: React.FC = () => {
  const { navigate } = useRouter();
  const initialToken = useState(() => new URLSearchParams(window.location.search).get("token") ?? "")[0];
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.confirmPasswordReset(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to reset password. The link may have expired.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="w-full max-w-sm">
        <button
          onClick={() => navigate("/login")}
          className="flex items-center gap-1 text-xs font-semibold mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
        </button>

        <div className="rounded-2xl p-6 space-y-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <h1 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            Set a new password
          </h1>

          {success ? (
            <div className="space-y-3">
              <div className="text-xs rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                Password reset. Every existing session was signed out — please sign in again.
              </div>
              <Button variant="primary" className="w-full" onClick={() => navigate("/login")}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
              <Field label="Reset token" hint="From your password-reset link.">
                <Input required value={token} onChange={(e) => setToken(e.target.value)} />
              </Field>
              <Field label="New password" hint="At least 10 characters.">
                <Input type="password" required minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </Field>
              <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Reset password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
