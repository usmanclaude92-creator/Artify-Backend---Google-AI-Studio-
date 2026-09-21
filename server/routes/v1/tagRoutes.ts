/** Tag CRUD (Phase 8 — docs/CMS_ARCHITECTURE.md). Reuses the existing content.* permissions (Phase 2) unchanged. */
import { Router } from "express";
import { tagService } from "../../services/tagService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createTagSchema, updateTagSchema } from "../../schemas/contentSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tags = await tagService.listTags(req.user!.organizationId);
    sendSuccess(res, { tags });
  })
);

router.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tag = await tagService.getTag(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { tag });
  })
);

router.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createTagSchema.parse(req.body);
    const tag = await tagService.createTag(req.user!, input, requestMeta(req));
    sendSuccess(res, { tag }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateTagSchema.parse(req.body);
    const tag = await tagService.updateTag(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { tag });
  })
);

router.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await tagService.deleteTag(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Tag deleted." });
  })
);

export default router;
