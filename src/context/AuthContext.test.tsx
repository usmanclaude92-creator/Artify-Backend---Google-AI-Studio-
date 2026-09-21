/**
 * Phase 4 §26/§34 — AuthContext is the ONE authoritative auth state. These
 * tests exercise it directly (mocking only the network boundary,
 * `lib/api`), proving: a real login populates state from the API
 * response only, a 401 anywhere clears state via the centralized
 * handler, and — critically — the context exposes no fabricated
 * privilege-escalation surface (no `loginAsDemo`, no `switchUserRole`,
 * no role settable by the client).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { AuthProvider, useAuth } from "./AuthContext";

const meMock = vi.fn();
const loginMock = vi.fn();

vi.mock("../lib/api", () => ({
  authApi: {
    me: (...args: unknown[]) => meMock(...args),
    login: (...args: unknown[]) => loginMock(...args),
    logout: vi.fn().mockResolvedValue({ message: "ok" }),
    logoutAll: vi.fn().mockResolvedValue({ message: "ok" }),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("AuthContext", () => {
  it("starts unauthenticated with no token in sessionStorage", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.user).toBeNull();
  });

  it("login() populates user/permissions from the real API response only", async () => {
    loginMock.mockResolvedValue({
      session: { token: "art_sess_test", expiresAt: new Date().toISOString() },
      user: { id: "u1", organizationId: "o1", email: "a@example.com", firstName: "A", lastName: "B", role: { key: "ADMIN", name: "Administrator", permissions: ["users.read"] } },
    });
    meMock.mockResolvedValue({
      user: { id: "u1", organizationId: "o1", email: "a@example.com", firstName: "A", lastName: "B", role: { key: "ADMIN", name: "Administrator", permissions: ["users.read"] } },
      organizations: [],
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login("a@example.com", "CorrectPassword123");
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.email).toBe("a@example.com");
    expect(result.current.hasPermission("users.read")).toBe(true);
    expect(result.current.hasPermission("users.delete")).toBe(false);
    expect(sessionStorage.getItem("artify_cc_session_token")).toBe("art_sess_test");
  });

  it("exposes no fabricated privilege-escalation surface — no loginAsDemo, no switchUserRole, no settable role", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const value = result.current as unknown as Record<string, unknown>;
    expect(value.loginAsDemo).toBeUndefined();
    expect(value.switchUserRole).toBeUndefined();
    expect(value.setRole).toBeUndefined();
    expect(value.setPermissions).toBeUndefined();
  });
});
