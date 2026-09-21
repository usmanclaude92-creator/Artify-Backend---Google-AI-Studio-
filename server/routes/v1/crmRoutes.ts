/** CRM dashboard summary (§21) — real counts only, each section gated by the caller's own permission (same degrade-gracefully pattern as the Phase 4 Control Center dashboard). */
import { Router } from "express";
import { leadService } from "../../services/leadService";
import { clientService } from "../../services/clientService";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions;
    const organizationId = req.user!.organizationId;

    const [leadCounts, leadRecent, clientCounts, clientRecent] = await Promise.all([
      permissions.includes("leads.read") ? leadService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("leads.read") ? leadService.recent(organizationId, 5) : Promise.resolve([]),
      permissions.includes("clients.read") ? clientService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("clients.read") ? clientService.recent(organizationId, 5) : Promise.resolve([]),
    ]);

    sendSuccess(res, {
      leads: leadCounts && {
        total: Object.values(leadCounts).reduce((a, b) => a + b, 0),
        new: leadCounts.NEW ?? 0,
        contacted: leadCounts.CONTACTED ?? 0,
        qualified: leadCounts.QUALIFIED ?? 0,
        converted: leadCounts.CONVERTED ?? 0,
        lost: leadCounts.LOST ?? 0,
        recent: leadRecent,
      },
      clients: clientCounts && {
        total: Object.values(clientCounts).reduce((a, b) => a + b, 0),
        prospect: clientCounts.PROSPECT ?? 0,
        active: clientCounts.ACTIVE ?? 0,
        inactive: clientCounts.INACTIVE ?? 0,
        suspended: clientCounts.SUSPENDED ?? 0,
        archived: clientCounts.ARCHIVED ?? 0,
        recent: clientRecent,
      },
    });
  })
);

export default router;
