/** Phase 6 §34 — onboarding queue: real data, empty state, error state, status filter, detail modal, completion action. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OnboardingPage } from "./OnboardingPage";

const listMock = vi.fn();
const completeMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  onboardingApi: {
    list: (...args: unknown[]) => listMock(...args),
    complete: (...args: unknown[]) => completeMock(...args),
  },
}));

let mockPermissions: string[] = ["onboarding.read", "onboarding.complete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

let mockPath = "/onboarding";
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: vi.fn() }) }));

const onboarding = {
  id: "onb-1",
  organizationId: "org-1",
  clientId: "client-1",
  status: "IN_PROGRESS",
  currentStep: "PRIMARY_CONTACT_CONFIRMED",
  checklist: [
    { key: "CLIENT_VERIFIED", label: "Client verified", completed: true, completedAt: "2026-01-01T00:00:00.000Z", completedById: "u1" },
    { key: "WORKSPACE_CREATED", label: "Workspace created", completed: true, completedAt: "2026-01-01T00:00:00.000Z", completedById: "u1" },
    { key: "PRIMARY_CONTACT_CONFIRMED", label: "Primary contact confirmed", completed: false, completedAt: null, completedById: null },
  ],
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  client: { id: "client-1", name: "Acme Corp", clientCode: "ACME-01" },
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  completeMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["onboarding.read", "onboarding.complete"];
  mockPath = "/onboarding";
});

beforeEach(() => {
  listMock.mockResolvedValue({ items: [onboarding], page: 1, limit: 20, total: 1, totalPages: 1 });
});

describe("OnboardingPage", () => {
  it("renders real onboarding records returned by the API, not fabricated data", async () => {
    render(<OnboardingPage />);
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("IN_PROGRESS")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
  });

  it("shows an empty state when there are no onboarding records", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<OnboardingPage />);
    expect(await screen.findByText(/no onboarding records/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Queue unavailable"));
    render(<OnboardingPage />);
    expect(await screen.findByText(/queue unavailable/i)).toBeInTheDocument();
  });

  it("opens a detail view showing the checklist when a row is clicked", async () => {
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByText("Acme Corp"));
    expect(await screen.findByText("Client verified")).toBeInTheDocument();
    expect(screen.getByText("Primary contact confirmed")).toBeInTheDocument();
  });

  it("defaults to a pending-status filter when on the Pending Onboarding nav path", async () => {
    mockPath = "/onboarding/pending";
    render(<OnboardingPage />);
    await screen.findByText("Acme Corp");
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "IN_PROGRESS" }));
  });

  it("completes onboarding from the detail view when the caller has onboarding.complete", async () => {
    const readyOnboarding = { ...onboarding, status: "READY", currentStep: null };
    listMock.mockResolvedValue({ items: [readyOnboarding], page: 1, limit: 20, total: 1, totalPages: 1 });
    completeMock.mockResolvedValue({ onboarding: { ...readyOnboarding, status: "COMPLETED" } });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByText("Acme Corp"));
    fireEvent.click(await screen.findByRole("button", { name: /complete onboarding/i }));

    await vi.waitFor(() => expect(completeMock).toHaveBeenCalledWith("onb-1"));
  });

  it("hides the complete-onboarding action when the caller lacks onboarding.complete", async () => {
    mockPermissions = ["onboarding.read"];
    const readyOnboarding = { ...onboarding, status: "READY", currentStep: null };
    listMock.mockResolvedValue({ items: [readyOnboarding], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByText("Acme Corp"));
    await screen.findByText("Client verified");
    expect(screen.queryByRole("button", { name: /complete onboarding/i })).not.toBeInTheDocument();
  });
});
