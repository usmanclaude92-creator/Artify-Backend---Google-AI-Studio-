/**
 * Phase 4 §9/§34 — the real login form, and a direct regression check
 * that no fabricated-auth shortcut (demo credentials, role switcher,
 * "Login as Admin") is rendered anywhere on it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoginPage } from "./LoginPage";

const loginMock = vi.fn();

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ login: loginMock }),
}));
vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));
vi.mock("../../lib/router", () => ({
  useRouter: () => ({ path: "/login", navigate: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  loginMock.mockReset();
});

describe("LoginPage", () => {
  it("renders a real email/password form with no fabricated-auth shortcuts", () => {
    render(<LoginPage />);

    expect(screen.getByPlaceholderText(/you@company.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/••••••••/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();

    const forbidden = [
      /login as admin/i,
      /demo super admin/i,
      /switch role/i,
      /demo credentials/i,
      /1-click/i,
      /instant.*demo/i,
    ];
    const body = document.body.textContent ?? "";
    for (const pattern of forbidden) {
      expect(body).not.toMatch(pattern);
    }
  });

  it("submits the entered credentials to the real login() call — nothing else grants access", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText(/you@company.com/i), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/), { target: { value: "CorrectPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await vi.waitFor(() => expect(loginMock).toHaveBeenCalledWith("user@example.com", "CorrectPassword123"));
  });

  it("shows the API's own error message on failed login, never a silent success", async () => {
    const { ApiClientError } = await import("../../lib/apiClient");
    loginMock.mockRejectedValueOnce(new ApiClientError("Invalid email or password credentials.", { code: "UNAUTHORIZED", status: 401 }));

    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText(/you@company.com/i), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid email or password/i);
  });
});
