/** Post CRUD + publish/schedule/revisions (Phase 8 — docs/CMS_ARCHITECTURE.md). Reuses the existing content.* permissions (Phase 2) unchanged. */
import { Router } from "express";
import { postService } from "../../services/postService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createPostSchema, updatePostSchema, listPostsQuerySchema } from "../../schemas/postSchemas";
import { scheduleContentSchema, revertContentSchema } from "../../schemas/contentSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listPostsQuerySchema.parse(req.query);
    const { rows, total } = await postService.listPosts(
      req.user!.organizationId,
      { search: query.search, status: query.status, categoryId: query.categoryId, tagId: query.tagId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const post = await postService.getPost(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { post });
  })
);

router.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await postService.listRevisions(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { revisions });
  })
);

router.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPostSchema.parse(req.body);
    const post = await postService.createPost(req.user!, input, requestMeta(req));
    sendSuccess(res, { post }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePostSchema.parse(req.body);
    const post = await postService.updatePost(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const post = await postService.submitForReview(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const post = await postService.publishPost(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const post = await postService.schedulePost(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const post = await postService.archivePost(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const post = await postService.revertPost(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { post });
  })
);

router.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await postService.deletePost(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Post deleted." });
  })
);

export default router;
