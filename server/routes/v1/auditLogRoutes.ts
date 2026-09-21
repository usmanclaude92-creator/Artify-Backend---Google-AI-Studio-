/** Phase 4 Audit Log UI — read-only, paginated, tenant-scoped. */
import { Router } from "express";
import { auditLogQueryRepository } from "../../repositories/auditLogQueryRepository";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listAuditLogsQuerySchema } from "../../schemas/auditLogSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);

    // Non-SUPER_ADMIN callers can only ever see their own organization's
    // audit trail — a caller-supplied organizationId is honored only for
    // SUPER_ADMIN (same convention as GET /users).
    const organizationId =
      req.user!.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user!.organizationId;

    const { rows, total } = await auditLogQueryRepository.list(
      {
        organizationId,
        actorUserId: query.actorUserId,
        action: query.action,
        resourceType: query.resourceType,
        result: query.result,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      query.page,
      query.limit
    );

    sendSuccess(res, { auditLogs: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

export default router;
