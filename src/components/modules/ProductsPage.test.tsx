/**
 * Phase 7 §50 — product catalog list/detail, module management (add/
 * activate-deactivate/archive/reorder), create/edit forms, empty/error
 * states, permission-gated actions, no fabricated products.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProductsPage } from "./ProductsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const archiveMock = vi.fn();
const modulesMock = vi.fn();
const addModuleMock = vi.fn();
const reorderModulesMock = vi.fn();
const moduleUpdateMock = vi.fn();
const moduleArchiveMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  productsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    modules: (...args: unknown[]) => modulesMock(...args),
    addModule: (...args: unknown[]) => addModuleMock(...args),
    reorderModules: (...args: unknown[]) => reorderModulesMock(...args),
  },
  productModulesApi: {
    get: vi.fn(),
    update: (...args: unknown[]) => moduleUpdateMock(...args),
    archive: (...args: unknown[]) => moduleArchiveMock(...args),
  },
}));

let mockPermissions: string[] = [
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "product_modules.read",
  "product_modules.create",
  "product_modules.update",
  "product_modules.archive",
  "product_modules.reorder",
];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const product = {
  id: "product-1",
  code: "HCMS-01",
  name: "Artify HCMS",
  slug: "artify-hcms",
  type: "PRODUCT" as const,
  shortDescription: "HR & payroll suite",
  description: null,
  status: "DRAFT" as const,
  isFeatured: false,
  displayOrder: 0,
  version: "1.0.0",
  createdById: null,
  updatedById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const moduleA = {
  id: "module-1",
  productId: "product-1",
  code: "EMPLOYEE",
  name: "Employee Management",
  slug: "employee-management",
  description: null,
  status: "ACTIVE" as const,
  displayOrder: 0,
  isCore: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const moduleB = { ...moduleA, id: "module-2", code: "PAYROLL", name: "Payroll", displayOrder: 1, isCore: false };

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  archiveMock.mockReset();
  modulesMock.mockReset();
  addModuleMock.mockReset();
  reorderModulesMock.mockReset();
  moduleUpdateMock.mockReset();
  moduleArchiveMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = [
    "products.read",
    "products.create",
    "products.update",
    "products.archive",
    "product_modules.read",
    "product_modules.create",
    "product_modules.update",
    "product_modules.archive",
    "product_modules.reorder",
  ];
});

beforeEach(() => {
  modulesMock.mockResolvedValue({ items: [moduleA, moduleB], page: 1, limit: 100, total: 2, totalPages: 1 });
});

describe("ProductsPage", () => {
  it("renders the product list and detail pane with real modules, not fabricated data", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ProductsPage />);

    expect(await screen.findAllByText("Artify HCMS")).not.toHaveLength(0);
    expect(await screen.findByText("Employee Management")).toBeInTheDocument();
    expect(screen.getByText("Payroll")).toBeInTheDocument();
  });

  it("shows an empty state when there are no products", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<ProductsPage />);
    expect(await screen.findByText(/no products found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Catalog unavailable"));
    render(<ProductsPage />);
    expect(await screen.findByText(/catalog unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty modules state for a product with no modules configured", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    modulesMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    render(<ProductsPage />);
    expect(await screen.findByText(/no modules configured/i)).toBeInTheDocument();
  });

  it("creates a product through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ product });
    render(<ProductsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new product/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^code$/i), { target: { value: "hcms-02" } });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Product" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create product/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ code: "hcms-02", name: "New Product" })));
  });

  it("adds a module to the selected product through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    addModuleMock.mockResolvedValue({ module: moduleA });
    render(<ProductsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /add module/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^code$/i), { target: { value: "LEAVE" } });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "Leave Management" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add module$/i }));

    await vi.waitFor(() => expect(addModuleMock).toHaveBeenCalledWith("product-1", expect.objectContaining({ code: "LEAVE", name: "Leave Management" })));
  });

  it("deactivates an active module through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    moduleUpdateMock.mockResolvedValue({ module: { ...moduleA, status: "INACTIVE" } });
    render(<ProductsPage />);

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getAllByRole("button", { name: /^deactivate$/i })[0]!);

    await vi.waitFor(() => expect(moduleUpdateMock).toHaveBeenCalledWith("module-1", { status: "INACTIVE" }));
  });

  it("reorders modules by moving one down, calling the real reorder API with the full new order", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    reorderModulesMock.mockResolvedValue({ message: "ok" });
    render(<ProductsPage />);

    await screen.findByText("Employee Management");
    const moveDownButtons = screen.getAllByLabelText(/move down/i);
    fireEvent.click(moveDownButtons[0]!);

    await vi.waitFor(() => expect(reorderModulesMock).toHaveBeenCalledWith("product-1", ["module-2", "module-1"]));
  });

  it("archives a module through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    moduleArchiveMock.mockResolvedValue({ module: { ...moduleA, status: "INACTIVE" } });
    render(<ProductsPage />);

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getAllByRole("button", { name: /^archive$/i })[1]!); // [0] is the product's own archive button

    await vi.waitFor(() => expect(moduleArchiveMock).toHaveBeenCalledWith("module-1"));
  });

  it("archives a product only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ product: { ...product, status: "ARCHIVED" } });
    render(<ProductsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("product-1"));
  });

  it("hides create/edit/archive/module actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["products.read", "product_modules.read"];
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ProductsPage />);

    await screen.findByText("Employee Management");
    expect(screen.queryByRole("button", { name: /new product/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add module/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deactivate$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/move down/i)).not.toBeInTheDocument();
  });

  it("filters by type and status, sending the filters to the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<ProductsPage />);
    await screen.findByText("Employee Management");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "SERVICE" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ type: "SERVICE" })));
  });
});
