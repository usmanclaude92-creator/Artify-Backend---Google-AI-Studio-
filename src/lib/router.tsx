/**
 * Minimal path-based router (Phase 4 §8) — no new routing dependency
 * (§37 "do not prematurely introduce complex state management"). Backed
 * by the real browser URL via History API, so reload/bookmark/back-button
 * all work, unlike the previous state-only `currentView` pattern this
 * replaces.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface RouterContextValue {
  path: string;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export const RouterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    if (next !== window.location.pathname) {
      window.history.pushState({}, "", next);
    }
    setPath(next);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within RouterProvider");
  return ctx;
}
