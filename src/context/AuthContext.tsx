/**
 * The ONE authoritative frontend authentication state (Phase 4 §26).
 * No component maintains a competing auth state; nothing here is
 * fabricated — every field is either the bearer token (opaque, sessionStorage)
 * or data returned by the real Phase 3 API.
 *
 * Token storage: sessionStorage, not localStorage — reduces the exposure
 * window (cleared when the tab closes, not shared across tabs) since no
 * cookie-based mechanism was introduced this phase (§5's "follow the
 * existing Phase 3 bearer-token architecture," which is header-only).
 * Both are equally reachable by injected JS if the app is XSS'd; this is a
 * real residual risk of the bearer-in-header architecture, not hidden —
 * see docs/CONTROL_CENTER_ARCHITECTURE.md.
 *
 * hasPermission() here is UX-only (§27/§28) — every actual mutation still
 * goes through the backend's own requirePermission/requireRole checks;
 * nothing about this context can grant a capability the API would reject.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authApi, type MembershipSummary, type SanitizedUser } from "../lib/api";
import { setAuthTokenGetter, setUnauthorizedHandler, ApiClientError } from "../lib/apiClient";

const TOKEN_STORAGE_KEY = "artify_cc_session_token";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: SanitizedUser | null;
  organizations: MembershipSummary[];
  sessionExpiredMessage: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Phase 6 — applies the session a client-admin invitation acceptance already returned, without a second round-trip login. */
  setSessionFromAcceptedInvitation: (token: string, user: SanitizedUser) => void;
  hasPermission: (key: string) => boolean;
  dismissSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_STORAGE_KEY));
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SanitizedUser | null>(null);
  const [organizations, setOrganizations] = useState<MembershipSummary[]>([]);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);

  // A ref mirrors `token` so apiClient's getter always reads the CURRENT
  // value synchronously. React state updates are not applied until the
  // next render, so a call chain like "set the token, then immediately
  // make an authenticated request" (login() below) would otherwise race:
  // the request could fire before the state update (and the effect that
  // used to re-register the getter from it) had committed.
  const tokenRef = useRef(token);
  const updateToken = useCallback((next: string | null) => {
    tokenRef.current = next;
    setToken(next);
  }, []);

  const clearAuthState = useCallback(
    (expiredMessage?: string) => {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      updateToken(null);
      setUser(null);
      setOrganizations([]);
      setStatus("unauthenticated");
      if (expiredMessage) setSessionExpiredMessage(expiredMessage);
    },
    [updateToken]
  );

  useEffect(() => {
    setAuthTokenGetter(() => tokenRef.current);
    return () => setAuthTokenGetter(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearAuthState("Your session has expired. Please sign in again."));
    return () => setUnauthorizedHandler(null);
  }, [clearAuthState]);

  const refreshMe = useCallback(async () => {
    const res = await authApi.me();
    setUser(res.user);
    setOrganizations(res.organizations);
    setStatus("authenticated");
  }, []);

  // Load the real user from the token on first mount / reload — never
  // trust a cached user object across a page reload (§26).
  useEffect(() => {
    if (!token) {
      setStatus("unauthenticated");
      return;
    }
    refreshMe().catch(() => {
      // apiClient's 401 handler already clears state for auth failures;
      // any other error (network) just leaves the user logged out of the UI
      // rather than presenting a stale/fabricated authenticated state.
      clearAuthState();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    sessionStorage.setItem(TOKEN_STORAGE_KEY, res.session.token);
    updateToken(res.session.token);
    setUser(res.user);
    setSessionExpiredMessage(null);
    const me = await authApi.me();
    setOrganizations(me.organizations);
    setStatus("authenticated");
  }, [updateToken]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the network call fails, the client must still drop its own state.
    }
    clearAuthState();
  }, [clearAuthState]);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } finally {
      clearAuthState();
    }
  }, [clearAuthState]);

  const switchOrganization = useCallback(async (organizationId: string) => {
    const res = await authApi.switchOrganization(organizationId);
    sessionStorage.setItem(TOKEN_STORAGE_KEY, res.session.token);
    updateToken(res.session.token);
    setUser(res.user);
    const me = await authApi.me();
    setOrganizations(me.organizations);
  }, [updateToken]);

  const hasPermissionFn = useCallback((key: string) => !!user?.role.permissions.includes(key), [user]);

  const setSessionFromAcceptedInvitation = useCallback(
    (nextToken: string, nextUser: SanitizedUser) => {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
      updateToken(nextToken);
      setUser(nextUser);
      setSessionExpiredMessage(null);
      setStatus("authenticated");
      authApi
        .me()
        .then((me) => setOrganizations(me.organizations))
        .catch(() => setOrganizations([]));
    },
    [updateToken]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      organizations,
      sessionExpiredMessage,
      login,
      logout,
      logoutAll,
      switchOrganization,
      refreshMe,
      setSessionFromAcceptedInvitation,
      hasPermission: hasPermissionFn,
      dismissSessionExpired: () => setSessionExpiredMessage(null),
    }),
    [
      status,
      user,
      organizations,
      sessionExpiredMessage,
      login,
      logout,
      logoutAll,
      switchOrganization,
      refreshMe,
      setSessionFromAcceptedInvitation,
      hasPermissionFn,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiClientError };
