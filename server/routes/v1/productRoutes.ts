/** Product catalog CRUD + nested module list/create/reorder (Phase 7 — docs/PRODUCT_CATALOG_ARCHITECTURE.md). Standalone module routes live in productModuleRoutes.ts. */
import { Router } from "express";
import { productService } from "../../services/productService";
import { productModuleService } from "../../services/productModuleService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createProductSchema, listProductsQuerySchema, updateProductSchema } from "../../schemas/productSchemas";
import { createProductModuleSchema, listProductModulesQuerySchema, reorderProductModulesSchema } from "../../schemas/productModuleSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const query = listProductsQuerySchema.parse(req.query);
    const { rows, total } = await productService.listProducts(
      { search: query.search, type: query.type, status: query.status, isFeatured: query.isFeatured },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(req.params.id!);
    sendSuccess(res, { product });
  })
);

router.post(
  "/",
  requirePermission("products.create"),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await productService.createProduct(req.user!, input, requestMeta(req));
    sendSuccess(res, { product }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("products.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { product });
  })
);

router.post(
  "/:id/archive",
  requirePermission("products.archive"),
  asyncHandler(async (req, res) => {
    const product = await productService.archiveProduct(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { product });
  })
);

router.get(
  "/:id/modules",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const query = listProductModulesQuerySchema.parse(req.query);
    const { rows, total } = await productModuleService.listModulesForProduct(req.params.id!, query.status, query.page, query.limit);
    sendSuccess(res, { modules: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.post(
  "/:id/modules",
  requirePermission("product_modules.create"),
  asyncHandler(async (req, res) => {
    const input = createProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.createModule(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { module: module_ }, 201);
  })
);

router.post(
  "/:id/modules/reorder",
  requirePermission("product_modules.reorder"),
  asyncHandler(async (req, res) => {
    const input = reorderProductModulesSchema.parse(req.body);
    await productModuleService.reorderModules(req.user!, req.params.id!, input.moduleIds, requestMeta(req));
    sendSuccess(res, { message: "Modules reordered." });
  })
);

export default router;
