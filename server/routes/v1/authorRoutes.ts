/** Author profile CRUD (Phase 8 — docs/CMS_ARCHITECTURE.md §Authors). No archive endpoint — see authorService.ts's header comment for why. */
import { Router } from "express";
import { authorService } from "../../services/authorService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createAuthorSchema, updateAuthorSchema } from "../../schemas/authorSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("authors.read"),
  asyncHandler(async (_req, res) => {
    const authors = await authorService.listAuthors();
    sendSuccess(res, { authors });
  })
);

router.get(
  "/:id",
  requirePermission("authors.read"),
  asyncHandler(async (req, res) => {
    const author = await authorService.getAuthor(req.params.id!);
    sendSuccess(res, { author });
  })
);

router.post(
  "/",
  requirePermission("authors.create"),
  asyncHandler(async (req, res) => {
    const input = createAuthorSchema.parse(req.body);
    const author = await authorService.createAuthor(req.user!, input, requestMeta(req));
    sendSuccess(res, { author }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("authors.update"),
  asyncHandler(async (req, res) => {
    const input = updateAuthorSchema.parse(req.body);
    const author = await authorService.updateAuthor(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { author });
  })
);

export default router;
