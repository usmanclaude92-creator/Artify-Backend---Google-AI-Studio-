/**
 * Public website API (Phase 11 — docs/PUBLIC_API_ARCHITECTURE.md).
 * Mounted at /api/v1/public. No `authenticateToken` anywhere in this file
 * — every route here is intentionally reachable by an anonymous browser.
 * That is exactly why it is also the most carefully bounded route file in
 * the codebase: every response is built from an explicit public-safe
 * projection (see publicSiteService.ts/publicProductService.ts), never the
 * raw repository row, and the one write endpoint (`POST /leads`) is both
 * schema-validated and rate-limited.
 */
import { Router } from "express";
import { publicSiteService } from "../../services/publicSiteService";
import { publicProductService } from "../../services/publicProductService";
import { publicLeadService } from "../../services/publicLeadService";
import { publicLeadLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createPublicLeadSchema,
  listPublicPostsQuerySchema,
  listPublicProductsQuerySchema,
} from "../../schemas/publicSchemas";

const router = Router();

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/site",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { configured: publicSiteService.isConfigured() });
  })
);

router.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const page = await publicSiteService.getPageBySlug(req.params.slug!);
    sendSuccess(res, { page });
  })
);

router.get(
  "/posts",
  asyncHandler(async (req, res) => {
    const query = listPublicPostsQuerySchema.parse(req.query);
    const { rows, total } = await publicSiteService.listPosts(
      { search: query.search, categorySlug: query.category, tagSlug: query.tag },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = await publicSiteService.getPostBySlug(req.params.slug!);
    sendSuccess(res, { post });
  })
);

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await publicSiteService.listCategories();
    sendSuccess(res, { categories });
  })
);

router.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await publicSiteService.listTags();
    sendSuccess(res, { tags });
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const query = listPublicProductsQuerySchema.parse(req.query);
    const { rows, total } = await publicProductService.listProducts({ search: query.search, type: query.type }, query.page, query.limit);
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/products/:slug",
  asyncHandler(async (req, res) => {
    const product = await publicProductService.getProductBySlug(req.params.slug!);
    sendSuccess(res, { product });
  })
);

router.get(
  "/products/:slug/modules",
  asyncHandler(async (req, res) => {
    const modules = await publicProductService.getProductModules(req.params.slug!);
    sendSuccess(res, { modules });
  })
);

router.post(
  "/leads",
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
    const input = createPublicLeadSchema.parse(req.body);
    await publicLeadService.createLead(input, requestMeta(req));
    // Always the same response whether the submission was real or
    // silently discarded as a honeypot hit (§8) — a bot must not be able
    // to distinguish the two from the response alone.
    sendSuccess(res, { message: "Thank you — your message has been received. We'll be in touch shortly." }, 201);
  })
);

export default router;
