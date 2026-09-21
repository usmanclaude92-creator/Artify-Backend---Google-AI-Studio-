/** Category CRUD (Phase 8 — docs/CMS_ARCHITECTURE.md). Reuses the existing content.* permissions (Phase 2) unchanged. */
import { Router } from "express";
import { categoryService } from "../../services/categoryService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createCategorySchema, updateCategorySchema } from "../../schemas/contentSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const categories = await categoryService.listCategories(req.user!.organizationId);
    sendSuccess(res, { categories });
  })
);

router.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const category = await categoryService.getCategory(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { category });
  })
);

router.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(req.user!, input, requestMeta(req));
    sendSuccess(res, { category }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { category });
  })
);

router.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await categoryService.deleteCategory(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Category deleted." });
  })
);

export default router;
