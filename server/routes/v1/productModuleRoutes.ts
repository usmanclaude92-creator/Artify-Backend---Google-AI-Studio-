/** Standalone product module endpoints (Phase 7) — GET/PATCH/archive by module id; creation/listing/reorder are nested under /products/:id/modules (productRoutes.ts). */
import { Router } from "express";
import { productModuleService } from "../../services/productModuleService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { updateProductModuleSchema } from "../../schemas/productModuleSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/:id",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.getModule(req.params.id!);
    sendSuccess(res, { module: module_ });
  })
);

router.patch(
  "/:id",
  requirePermission("product_modules.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.updateModule(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { module: module_ });
  })
);

router.post(
  "/:id/archive",
  requirePermission("product_modules.archive"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.archiveModule(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { module: module_ });
  })
);

export default router;
