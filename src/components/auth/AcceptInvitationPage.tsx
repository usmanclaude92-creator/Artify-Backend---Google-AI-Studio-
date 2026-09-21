/** Phase 6 §21/§30 — public acceptance page. Token read from the URL query string, same convention as ResetPasswordPage. Never shows invitation secrets. */
import React, { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { invitationsApi } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { Button, Input, Field, Spinner } from "../ui/ui";
import type { InvitationPreview } from "../../lib/api";

export const AcceptInvitationPage: React.FC = () => {
  const { navigate } = useRouter();
  const { setSessionFromAcceptedInvitation } = useAuth();
  const token = useState(() => new URLSearchParams(window.location.search).get("token") ?? "")[0];

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("This invitation link is missing its token.");
      setLoading(false);
      return;
    }
    invitationsApi
      .preview(token)
      .then(setPreview)
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : "This invitation link is invalid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (preview?.requiresPassword && password !== confirmPassword) {
      setSubmitError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await invitationsApi.accept(token, preview?.requiresPassword ? { firstName, lastName, password } : {});
      setAccepted(true);
      setSessionFromAcceptedInvitation(result.session.token, result.user);
    } catch (err) {
      setSubmitError(err instanceof ApiClientError ? err.message : "Could not accept this invitation.");
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
            Accept workspace invitation
          </h1>

          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : loadError || !preview ? (
            <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">
              {loadError ?? "This invitation link is invalid or has expired."}
            </div>
          ) : accepted ? (
            <div className="space-y-3">
              <div className="text-xs rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                You're in! Redirecting to your workspace…
              </div>
              <Button variant="primary" className="w-full" onClick={() => navigate("/dashboard")}>
                Continue
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                You've been invited to join <strong>{preview.workspaceName}</strong> as {preview.roleName} ({preview.email}).
              </p>
              {submitError && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{submitError}</div>}
              {preview.requiresPassword && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First name">
                      <Input required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </Field>
                    <Field label="Last name">
                      <Input required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Password" hint="At least 10 characters.">
                    <Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <Field label="Confirm password">
                    <Input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </Field>
                </>
              )}
              <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {preview.requiresPassword ? "Create account & accept" : "Accept invitation"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
