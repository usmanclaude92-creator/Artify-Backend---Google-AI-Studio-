/** Subscription CRUD + lifecycle (Phase 10 — docs/BILLING_ARCHITECTURE.md). */
import { Router } from "express";
import { subscriptionService } from "../../services/subscriptionService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  updateSubscriptionSchema,
} from "../../schemas/subscriptionSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = listSubscriptionsQuerySchema.parse(req.query);
    const { rows, total } = await subscriptionService.listSubscriptions(
      req.user!.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId, productId: query.productId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.getSubscription(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { subscription });
  })
);

router.post(
  "/",
  requirePermission("subscriptions.create"),
  asyncHandler(async (req, res) => {
    const input = createSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.createSubscription(req.user!, input, requestMeta(req));
    sendSuccess(res, { subscription }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("subscriptions.update"),
  asyncHandler(async (req, res) => {
    const input = updateSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.updateSubscription(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { subscription });
  })
);

router.post(
  "/:id/activate",
  requirePermission("subscriptions.activate"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.activateSubscription(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { subscription });
  })
);

router.post(
  "/:id/pause",
  requirePermission("subscriptions.pause"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.pauseSubscription(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { subscription });
  })
);

router.post(
  "/:id/cancel",
  requirePermission("subscriptions.cancel"),
  asyncHandler(async (req, res) => {
    const input = cancelSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.cancelSubscription(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { subscription });
  })
);

export default router;
