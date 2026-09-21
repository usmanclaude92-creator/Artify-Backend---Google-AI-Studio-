/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./context/ToastContext";
import { RouterProvider, useRouter } from "./lib/router";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./components/auth/LoginPage";
import { ForgotPasswordPage } from "./components/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./components/auth/ResetPasswordPage";
import { AcceptInvitationPage } from "./components/auth/AcceptInvitationPage";
import { Spinner } from "./components/ui/ui";

const AUTH_PATHS = ["/login", "/forgot-password", "/reset-password"];
// Reachable regardless of auth status (Phase 6 §21/§30) — an invitee
// typically has no session yet, but an already-authenticated user (e.g.
// accepting a second workspace) must also be able to open the link without
// being redirected away from it.
const PUBLIC_PATHS = ["/accept-invitation"];

const AppContent: React.FC = () => {
  const { status, sessionExpiredMessage, dismissSessionExpired } = useAuth();
  const { path, navigate } = useRouter();

  React.useEffect(() => {
    if (PUBLIC_PATHS.includes(path)) return;
    if (status === "unauthenticated" && !AUTH_PATHS.includes(path)) {
      navigate("/login");
    }
    if (status === "authenticated" && AUTH_PATHS.includes(path)) {
      navigate("/dashboard");
    }
  }, [status, path, navigate]);

  if (PUBLIC_PATHS.includes(path)) {
    return <AcceptInvitationPage />;
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
        <Spinner />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <>
        {sessionExpiredMessage && (
          <div className="fixed top-0 inset-x-0 z-[60] bg-amber-500 text-white text-xs font-semibold text-center py-2">
            {sessionExpiredMessage}
            <button onClick={dismissSessionExpired} className="ml-3 underline">
              Dismiss
            </button>
          </div>
        )}
        {path === "/forgot-password" ? (
          <ForgotPasswordPage />
        ) : path === "/reset-password" ? (
          <ResetPasswordPage />
        ) : (
          <LoginPage />
        )}
      </>
    );
  }

  return <AppShell />;
};

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </RouterProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
