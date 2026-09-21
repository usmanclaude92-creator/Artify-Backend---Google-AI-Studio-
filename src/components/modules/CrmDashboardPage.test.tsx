/** Phase 5 §21/§34 — CRM dashboard renders only real counts from /crm/summary, degrades per-permission, never fabricates. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CrmDashboardPage } from "./CrmDashboardPage";

const summaryMock = vi.fn();

vi.mock("../../lib/api", () => ({
  crmApi: { summary: (...args: unknown[]) => summaryMock(...args) },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions: ["leads.read", "clients.read"] } } }),
}));

afterEach(() => {
  cleanup();
  summaryMock.mockReset();
});

describe("CrmDashboardPage", () => {
  it("renders real lead and client counts from the API", async () => {
    summaryMock.mockResolvedValue({
      leads: { total: 12, new: 4, contacted: 2, qualified: 3, converted: 2, lost: 1, recent: [] },
      clients: { total: 5, prospect: 1, active: 3, inactive: 0, suspended: 0, archived: 1, recent: [] },
    });
    render(<CrmDashboardPage />);
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("degrades gracefully when a metric's permission is missing (null section), never fabricating a value", async () => {
    summaryMock.mockResolvedValue({ leads: null, clients: { total: 5, prospect: 1, active: 3, inactive: 0, suspended: 0, archived: 1, recent: [] } });
    render(<CrmDashboardPage />);
    await screen.findByText("5");
    expect(screen.queryByText(/^leads$/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the summary call fails", async () => {
    summaryMock.mockRejectedValue(new Error("Unavailable"));
    render(<CrmDashboardPage />);
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });
});
