/**
 * Public website product/service catalog projection (Phase 11 —
 * docs/PUBLIC_API_ARCHITECTURE.md). Read-only, unauthenticated.
 * Product/ProductModule are platform-global (no organization scoping —
 * see productRepository.ts), so unlike CMS content this needs no
 * `PUBLIC_WEBSITE_ORGANIZATION_ID` resolution. Only `ACTIVE` products and
 * `ACTIVE` modules are ever visible — DRAFT/INACTIVE/ARCHIVED are never
 * returned, and no internal field (createdById/updatedById/configuration)
 * is included.
 */
import { productRepository } from "../repositories/productRepository";
import { productModuleRepository } from "../repositories/productModuleRepository";
import { NotFoundError } from "../core/errors";
import type { Product, ProductModule } from "@prisma/client";

function projectProduct(product: Product) {
  return {
    slug: product.slug,
    code: product.code,
    name: product.name,
    type: product.type,
    shortDescription: product.shortDescription,
    description: product.description,
    isFeatured: product.isFeatured,
    displayOrder: product.displayOrder,
  };
}

function projectModule(module_: ProductModule) {
  return {
    slug: module_.slug,
    code: module_.code,
    name: module_.name,
    description: module_.description,
    isCore: module_.isCore,
    displayOrder: module_.displayOrder,
  };
}

export const publicProductService = {
  async listProducts(filters: { search?: string; type?: string }, page: number, limit: number) {
    const { rows, total } = await productRepository.list({ ...filters, status: "ACTIVE" }, page, limit, "displayOrder", "asc");
    return { rows: rows.map(projectProduct), total };
  },

  async getProductBySlug(slug: string) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    return projectProduct(product);
  },

  async getProductModules(slug: string) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    const { rows } = await productModuleRepository.listForProduct(product.id, "ACTIVE", 1, 100);
    return rows.map(projectModule);
  },
};
