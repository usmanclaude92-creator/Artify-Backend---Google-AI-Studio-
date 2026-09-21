/**
 * Invitation revoke (authenticated) + the public token preview/accept pair
 * (Phase 6 §21/§26) — deliberately NOT behind `router.use(authenticateToken)`
 * since an invitee has no session yet. Creation/listing are nested under
 * /workspaces/:id/invitations (workspaceRoutes.ts).
 */
import { Router } from "express";
import { invitationService } from "../../services/invitationService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { acceptInvitationSchema } from "../../schemas/invitationSchemas";

const router = Router();

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.post(
  "/:id/revoke",
  authenticateToken,
  requirePermission("invitations.revoke"),
  asyncHandler(async (req, res) => {
    await invitationService.revokeInvitation(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Invitation revoked." });
  })
);

/** Public — returns only what's needed to render a safe acceptance form (§26): never a token hash, internal ids, or user security metadata. */
router.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const preview = await invitationService.previewInvitation(req.params.token!);
    sendSuccess(res, preview);
  })
);

router.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const input = acceptInvitationSchema.parse(req.body);
    const result = await invitationService.acceptInvitation(req.params.token!, input, requestMeta(req));
    sendSuccess(res, result, 201);
  })
);

export default router;
