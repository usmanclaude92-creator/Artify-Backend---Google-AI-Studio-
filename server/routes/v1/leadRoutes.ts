import { Router } from "express";
import { leadService } from "../../services/leadService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createLeadSchema, listLeadsQuerySchema, updateLeadSchema, convertLeadSchema } from "../../schemas/leadSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const query = listLeadsQuerySchema.parse(req.query);
    const { rows, total } = await leadService.listLeads(
      req.user!.organizationId,
      { search: query.search, status: query.status, source: query.source, assignedTo: query.assignedTo, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { leads: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const lead = await leadService.getLead(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { lead });
  })
);

router.post(
  "/",
  requirePermission("leads.create"),
  asyncHandler(async (req, res) => {
    const input = createLeadSchema.parse(req.body);
    const lead = await leadService.createLead(req.user!, input, requestMeta(req));
    sendSuccess(res, { lead }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("leads.update"),
  asyncHandler(async (req, res) => {
    const input = updateLeadSchema.parse(req.body);
    const lead = await leadService.updateLead(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { lead });
  })
);

router.delete(
  "/:id",
  requirePermission("leads.delete"),
  asyncHandler(async (req, res) => {
    await leadService.deleteLead(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Lead archived." });
  })
);

router.post(
  "/:id/convert",
  requirePermission("leads.convert"),
  asyncHandler(async (req, res) => {
    const input = convertLeadSchema.parse(req.body);
    const result = await leadService.convertLead(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, result, 201);
  })
);

export default router;
