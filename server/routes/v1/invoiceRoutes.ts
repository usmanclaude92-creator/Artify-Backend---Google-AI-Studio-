/** Invoice CRUD + lifecycle + payments (Phase 10 — docs/BILLING_ARCHITECTURE.md). */
import { Router } from "express";
import { invoiceService } from "../../services/invoiceService";
import { paymentService } from "../../services/paymentService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createInvoiceSchema,
  issueInvoiceSchema,
  listInvoicesQuerySchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from "../../schemas/invoiceSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const query = listInvoicesQuerySchema.parse(req.query);
    const { rows, total } = await invoiceService.listInvoices(
      req.user!.organizationId,
      {
        search: query.search,
        status: query.status,
        clientId: query.clientId,
        contractId: query.contractId,
        subscriptionId: query.subscriptionId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await invoiceService.getInvoice(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { invoice });
  })
);

router.post(
  "/",
  requirePermission("invoices.create"),
  asyncHandler(async (req, res) => {
    const input = createInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.createInvoice(req.user!, input, requestMeta(req));
    sendSuccess(res, { invoice }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("invoices.update"),
  asyncHandler(async (req, res) => {
    const input = updateInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.updateInvoice(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { invoice });
  })
);

router.post(
  "/:id/issue",
  requirePermission("invoices.issue"),
  asyncHandler(async (req, res) => {
    const input = issueInvoiceSchema.parse(req.body ?? {});
    const invoice = await invoiceService.issueInvoice(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { invoice });
  })
);

router.post(
  "/:id/void",
  requirePermission("invoices.void"),
  asyncHandler(async (req, res) => {
    const input = voidInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.voidInvoice(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { invoice });
  })
);

router.get(
  "/:id/payments",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const { rows, total } = await paymentService.listPayments(req.user!.organizationId, { invoiceId: req.params.id! }, 1, 100, "paymentDate", "asc");
    sendSuccess(res, { payments: rows }, 200, { page: 1, limit: 100, total });
  })
);

router.post(
  "/:id/payments",
  requirePermission("payments.create"),
  asyncHandler(async (req, res) => {
    const input = recordPaymentSchema.parse(req.body);
    const payment = await invoiceService.recordPayment(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { payment }, 201);
  })
);

export default router;
