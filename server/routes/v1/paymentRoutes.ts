/** Payment list/detail + reversal (Phase 10 — docs/BILLING_ARCHITECTURE.md). Recording a payment is POST /invoices/:id/payments — see invoiceRoutes.ts. */
import { Router } from "express";
import { paymentService } from "../../services/paymentService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listPaymentsQuerySchema, reversePaymentSchema } from "../../schemas/paymentSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const query = listPaymentsQuerySchema.parse(req.query);
    const { rows, total } = await paymentService.listPayments(
      req.user!.organizationId,
      { status: query.status, method: query.method, invoiceId: query.invoiceId, clientId: query.clientId, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const payment = await paymentService.getPayment(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { payment });
  })
);

router.post(
  "/:id/reverse",
  requirePermission("payments.reverse"),
  asyncHandler(async (req, res) => {
    const input = reversePaymentSchema.parse(req.body);
    const payment = await paymentService.reversePayment(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { payment });
  })
);

export default router;
