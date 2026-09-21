/** Phase 7 §31-36 — Product catalog: searchable/filterable/paginated list + master-detail with embedded module management (add/edit/activate-deactivate/archive/reorder). */
import React, { useEffect, useState } from "react";
import { Package, Plus, Search, Star, ArrowUp, ArrowDown, Archive } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  productsApi,
  productModulesApi,
  type CatalogProduct,
  type ProductModule,
  type ProductTypeValue,
  type ProductStatusValue,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const TYPE_OPTIONS: ProductTypeValue[] = ["PRODUCT", "SERVICE"];
const STATUS_OPTIONS: ProductStatusValue[] = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];
const STATUS_TONE: Record<ProductStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  INACTIVE: "warning",
  ARCHIVED: "danger",
};
const MODULE_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  INACTIVE: "warning",
};

const ProductFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (product?: CatalogProduct) => void;
  mode: "create" | "edit";
  product?: CatalogProduct;
}> = ({ open, onClose, onSaved, mode, product }) => {
  const { notify } = useToast();
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [type, setType] = useState<ProductTypeValue>(product?.type ?? "PRODUCT");
  const [shortDescription, setShortDescription] = useState(product?.shortDescription ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [status, setStatus] = useState<ProductStatusValue>(product?.status ?? "DRAFT");
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(product?.code ?? "");
      setName(product?.name ?? "");
      setSlug(product?.slug ?? "");
      setType(product?.type ?? "PRODUCT");
      setShortDescription(product?.shortDescription ?? "");
      setDescription(product?.description ?? "");
      setStatus(product && product.status !== "ARCHIVED" ? product.status : "DRAFT");
      setIsFeatured(product?.isFeatured ?? false);
      setError(null);
    }
  }, [open, product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await productsApi.create({ code, name, slug: slug || undefined, type, shortDescription, description, status, isFeatured });
        notify("Product created.", "success");
        onSaved(res.product);
      } else if (product) {
        const res = await productsApi.update(product.id, { name, slug, type, shortDescription, description, status, isFeatured });
        notify("Product updated.", "success");
        onSaved(res.product);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save product.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New product" : `Edit ${product?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input required disabled={mode === "edit"} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug" hint="Leave blank to auto-generate from the name.">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as ProductTypeValue)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Short description">
          <Input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} maxLength={300} />
        </Field>
        <Field label="Description">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 items-end">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatusValue)}>
              {STATUS_OPTIONS.filter((s) => s !== "ARCHIVED").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-xs pb-2" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} />
            Featured
          </label>
        </div>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create product" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ModuleFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; productId: string }> = ({
  open,
  onClose,
  onSaved,
  productId,
}) => {
  const { notify } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isCore, setIsCore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setName("");
      setDescription("");
      setIsCore(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await productsApi.addModule(productId, { code, name, description, isCore });
      notify("Module added.", "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add module.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add module">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} />
          Core module
        </label>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Add module
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ProductDetail: React.FC<{ product: CatalogProduct; onChanged: (p?: CatalogProduct) => void }> = ({ product, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "products.update");
  const canArchive = hasPermission(user?.role.permissions, "products.archive");
  const canCreateModule = hasPermission(user?.role.permissions, "product_modules.create");
  const canUpdateModule = hasPermission(user?.role.permissions, "product_modules.update");
  const canArchiveModule = hasPermission(user?.role.permissions, "product_modules.archive");
  const canReorderModules = hasPermission(user?.role.permissions, "product_modules.reorder");

  const [modules, setModules] = useState<ProductModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  const loadModules = React.useCallback(async () => {
    setModulesLoading(true);
    try {
      const res = await productsApi.modules(product.id, { limit: 100 });
      setModules(res.items);
    } catch {
      setModules([]);
    } finally {
      setModulesLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const handleToggleModuleStatus = async (module_: ProductModule) => {
    try {
      await productModulesApi.update(module_.id, { status: module_.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      notify(module_.status === "ACTIVE" ? "Module deactivated." : "Module activated.", "success");
      void loadModules();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update module.", "error");
    }
  };

  const handleArchiveModule = async (module_: ProductModule) => {
    try {
      await productModulesApi.archive(module_.id);
      notify("Module archived.", "success");
      void loadModules();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive module.", "error");
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;
    const reordered = [...modules];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setReordering(true);
    try {
      await productsApi.reorderModules(
        product.id,
        reordered.map((m) => m.id)
      );
      setModules(reordered);
      notify("Modules reordered.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not reorder modules.", "error");
      void loadModules();
    } finally {
      setReordering(false);
    }
  };

  const handleArchive = async () => {
    try {
      await productsApi.archive(product.id);
      notify("Product archived.", "success");
      onChanged();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not archive product.", "error");
    } finally {
      setArchiveOpen(false);
    }
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {product.name}
            <Badge tone={STATUS_TONE[product.status]}>{product.status}</Badge>
            {product.isFeatured && (
              <Badge tone="info">
                <Star className="w-2.5 h-2.5 inline mr-0.5" /> Featured
              </Badge>
            )}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {product.code} · {product.type} · /{product.slug}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {canUpdate && (
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          {canArchive && product.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2 text-xs border-b" style={{ borderColor: "var(--border)" }}>
        {product.shortDescription && <p style={{ color: "var(--text-primary)" }}>{product.shortDescription}</p>}
        {product.description && (
          <p style={{ color: "var(--text-secondary)" }} className="whitespace-pre-wrap">
            {product.description}
          </p>
        )}
        {!product.shortDescription && !product.description && (
          <p style={{ color: "var(--text-muted)" }}>No description yet.</p>
        )}
      </div>

      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Modules
        </h3>
        {canCreateModule && product.status !== "ARCHIVED" && (
          <Button variant="primary" onClick={() => setAddModuleOpen(true)}>
            <Plus className="w-3.5 h-3.5" /> Add module
          </Button>
        )}
      </div>

      {modulesLoading ? (
        <LoadingState />
      ) : modules.length === 0 ? (
        <EmptyState title="No modules configured" description="Add a module for this product." />
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {modules.map((m, index) => (
            <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                  {m.name}
                  {m.isCore && <Badge tone="info">Core</Badge>}
                  <Badge tone={MODULE_STATUS_TONE[m.status]}>{m.status}</Badge>
                </p>
                <p style={{ color: "var(--text-muted)" }}>{m.code}</p>
              </div>
              <div className="flex gap-1.5 shrink-0 items-center">
                {canReorderModules && (
                  <>
                    <Button variant="ghost" disabled={reordering || index === 0} onClick={() => void handleMove(index, -1)} aria-label="Move up">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={reordering || index === modules.length - 1}
                      onClick={() => void handleMove(index, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
                {canUpdateModule && m.status !== "INACTIVE" && (
                  <Button variant="secondary" onClick={() => void handleToggleModuleStatus(m)}>
                    {m.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {canUpdateModule && m.status === "INACTIVE" && (
                  <Button variant="secondary" onClick={() => void handleToggleModuleStatus(m)}>
                    Activate
                  </Button>
                )}
                {canArchiveModule && m.status !== "INACTIVE" && (
                  <Button variant="danger" onClick={() => void handleArchiveModule(m)}>
                    Archive
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProductFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" product={product} />
      <ModuleFormModal open={addModuleOpen} onClose={() => setAddModuleOpen(false)} onSaved={loadModules} productId={product.id} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive product"
        message={`Archive "${product.name}"? It will be preserved for historical/future commercial references but hidden from active use.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
    </Card>
  );
};

export const ProductsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "products.create");

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [type, setType] = useState<ProductTypeValue | "">("");
  const [status, setStatus] = useState<ProductStatusValue | "">("");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, type, status, featuredOnly]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await productsApi.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        type: type || undefined,
        status: status || undefined,
        isFeatured: featuredOnly || undefined,
      });
      setProducts(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((p) => p.id === prev.id) ? res.items.find((p) => p.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, type, status, featuredOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Package className="w-5 h-5" /> Products
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            The platform product & service catalog.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New product
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as ProductTypeValue | "")}>
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-xs px-2" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} />
          Featured only
        </label>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : products.length === 0 ? (
        <Card>
          <EmptyState title="No products found" description="Create a product or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate flex items-center gap-1">
                  {p.isFeatured && <Star className="w-3 h-3 shrink-0" />}
                  {p.name}
                </span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selected && <ProductDetail product={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <ProductFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
