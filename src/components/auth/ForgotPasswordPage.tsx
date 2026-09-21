/** Phase 4 §10 — request-reset UI. Generic success response, no account enumeration surfaced to the user. */
import React, { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { authApi } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useRouter } from "../../lib/router";
import { Button, Input, Field } from "../ui/ui";

export const ForgotPasswordPage: React.FC = () => {
  const { navigate } = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; devToken?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authApi.requestPasswordReset(email);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
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
            Reset your password
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Enter your account email. If it exists, we'll send reset instructions.
          </p>

          {result ? (
            <div className="space-y-3">
              <div className="text-xs rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                {result.message}
              </div>
              {result.devToken && (
                <div className="text-[11px] rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600 border border-amber-500/30 space-y-1">
                  <p className="font-semibold">Development-only helper (never shown in production)</p>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => navigate(`/reset-password?token=${encodeURIComponent(result.devToken!)}`)}
                  >
                    Continue to reset form
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
              <Field label="Email">
                <Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Send reset instructions
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
