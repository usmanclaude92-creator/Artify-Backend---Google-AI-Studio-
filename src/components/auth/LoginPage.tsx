/**
 * Real login (Phase 4 §9). No demo-credential buttons, no role switcher,
 * no instant-privileged-account shortcut — every credential is verified
 * server-side.
 */
import React, { useState } from "react";
import { ShieldCheck, Sun, Moon, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useRouter } from "../../lib/router";
import { ApiClientError } from "../../lib/apiClient";
import { Button, Input, Field } from "../ui/ui";

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { navigate } = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <button
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="fixed top-4 right-4 p-2 rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
      >
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6 gap-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--accent)" }}>
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            Artify Control Center
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sign in with your Artify account
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          {error && (
            <div role="alert" className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">
              {error}
            </div>
          )}

          <Field label="Email">
            <Input
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigate("/forgot-password")}
              className="text-xs font-semibold"
              style={{ color: "var(--accent)" }}
            >
              Forgot password?
            </button>
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
};
