/** Phase 4 §22 — theme is presentation state, safe to persist client-side and toggle without any auth dependency. */
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useTheme } from "./ThemeContext";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeContext", () => {
  it("toggles the theme and reflects it as a class on <html> for Tailwind's dark: variant", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const initial = result.current.theme;

    act(() => result.current.toggleTheme());

    expect(result.current.theme).not.toBe(initial);
    expect(document.documentElement.classList.contains("dark")).toBe(result.current.theme === "dark");
  });

  it("persists the preference to localStorage (presentation state, not auth state)", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.toggleTheme());
    expect(localStorage.getItem("artify_cc_theme")).toBe(result.current.theme);
  });
});
