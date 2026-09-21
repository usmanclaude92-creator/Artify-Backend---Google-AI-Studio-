/**
 * Phase 4 §8/§28 — a route the caller lacks the permission for renders
 * "Access denied," never the protected page's content and never a silent
 * fallback to allow. This is a UX check only — tests/security/
 * authBypass.test.ts (server) proves the backend rejects it too,
 * independent of what this component decides to render.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const ProtectedPage = () => <div>Protected page content</div>;
const OpenPage = () => <div>Open page content</div>;

vi.mock("../../lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("../../lib/permissions")>("../../lib/permissions");
  return {
    ...actual,
    NAV_ITEMS: [
      { id: "open", label: "Open", path: "/dashboard", icon: () => null, component: OpenPage },
      { id: "protected", label: "Protected", path: "/users", icon: () => null, requiresAnyPermission: ["users.read"], component: ProtectedPage },
    ],
  };
});

let mockUser: { role: { permissions: string[] } } | null = { role: { permissions: [] } };
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, organizations: [], logout: vi.fn(), logoutAll: vi.fn(), switchOrganization: vi.fn() }),
}));
vi.mock("../../context/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

let mockPath = "/users";
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: vi.fn() }) }));

afterEach(() => {
  cleanup();
  mockUser = { role: { permissions: [] } };
  mockPath = "/users";
});

describe("AppShell permission gating", () => {
  it("renders Access denied for a route whose permission the user lacks", async () => {
    const { AppShell } = await import("./AppShell");
    render(<AppShell />);
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByText("Protected page content")).not.toBeInTheDocument();
  });

  it("renders the real page once the permission is present — proving the gate isn't just always-closed", async () => {
    mockUser = { role: { permissions: ["users.read"] } };
    const { AppShell } = await import("./AppShell");
    render(<AppShell />);
    expect(await screen.findByText("Protected page content")).toBeInTheDocument();
  });

  it("an unrestricted item renders for any authenticated user regardless of permissions", async () => {
    mockPath = "/dashboard";
    const { AppShell } = await import("./AppShell");
    render(<AppShell />);
    expect(await screen.findByText("Open page content")).toBeInTheDocument();
  });
});
