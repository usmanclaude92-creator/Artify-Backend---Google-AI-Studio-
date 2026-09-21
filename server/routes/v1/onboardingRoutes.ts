/** Onboarding queue + detail (Phase 6 §25/§27) — creation is nested under /clients/:clientId/onboarding/start (clientRoutes.ts). */
import { Router } from "express";
import { onboardingService } from "../../services/onboardingService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listOnboardingQuerySchema, updateOnboardingSchema } from "../../schemas/onboardingSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const query = listOnboardingQuerySchema.parse(req.query);
    const { rows, total } = await onboardingService.listOnboarding(
      req.user!.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { onboarding: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboarding(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { onboarding: record });
  })
);

router.patch(
  "/:id",
  requirePermission("onboarding.update"),
  asyncHandler(async (req, res) => {
    const input = updateOnboardingSchema.parse(req.body);
    const record = await onboardingService.updateOnboarding(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { onboarding: record });
  })
);

router.post(
  "/:id/complete",
  requirePermission("onboarding.complete"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.completeOnboarding(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { onboarding: record });
  })
);

export default router;
