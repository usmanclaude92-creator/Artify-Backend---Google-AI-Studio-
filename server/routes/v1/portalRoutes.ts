/** Client Portal — read-only (Phase 10 §25/§26 — docs/CLIENT_PORTAL_ARCHITECTURE.md). Every handler resolves the caller's own session organization to its Client row inside clientPortalService — never a client-supplied id. */
import { Router } from "express";
import { z } from "zod";
import { clientPortalService } from "../../services/clientPortalService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { invoiceStatusSchema } from "../../schemas/invoiceSchemas";

const router = Router();

router.use(authenticateToken);

const pageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

router.get(
  "/dashboard",
  requirePermission("portal.dashboard.read"),
  asyncHandler(async (req, res) => {
    const dashboard = await clientPortalService.getDashboard(req.user!);
    sendSuccess(res, { dashboard });
  })
);

router.get(
  "/contracts",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listContracts(req.user!, query.page, query.limit);
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/contracts/:id",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await clientPortalService.getContract(req.user!, req.params.id!);
    sendSuccess(res, { contract });
  })
);

router.get(
  "/subscriptions",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listSubscriptions(req.user!, query.page, query.limit);
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/subscriptions/:id",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await clientPortalService.getSubscription(req.user!, req.params.id!);
    sendSuccess(res, { subscription });
  })
);

router.get(
  "/invoices",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.extend({ status: invoiceStatusSchema.optional() }).parse(req.query);
    const { rows, total } = await clientPortalService.listInvoices(req.user!, query.page, query.limit, query.status);
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/invoices/:id",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await clientPortalService.getInvoice(req.user!, req.params.id!);
    sendSuccess(res, { invoice });
  })
);

router.get(
  "/payments",
  requirePermission("portal.payments.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listPayments(req.user!, query.page, query.limit);
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

export default router;
