/** Contract CRUD + lifecycle + variations (Phase 10 — docs/COMMERCIAL_ARCHITECTURE.md). */
import { Router } from "express";
import { contractService } from "../../services/contractService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  createContractSchema,
  createContractVariationSchema,
  listContractsQuerySchema,
  terminateContractSchema,
  updateContractSchema,
} from "../../schemas/contractSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const query = listContractsQuerySchema.parse(req.query);
    const { rows, total } = await contractService.listContracts(
      req.user!.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.getContract(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { contract });
  })
);

router.post(
  "/",
  requirePermission("contracts.create"),
  asyncHandler(async (req, res) => {
    const input = createContractSchema.parse(req.body);
    const contract = await contractService.createContract(req.user!, input, requestMeta(req));
    sendSuccess(res, { contract }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("contracts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContractSchema.parse(req.body);
    const contract = await contractService.updateContract(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { contract });
  })
);

router.post(
  "/:id/activate",
  requirePermission("contracts.activate"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.activateContract(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { contract });
  })
);

router.post(
  "/:id/suspend",
  requirePermission("contracts.suspend"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.suspendContract(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { contract });
  })
);

router.post(
  "/:id/terminate",
  requirePermission("contracts.terminate"),
  asyncHandler(async (req, res) => {
    const input = terminateContractSchema.parse(req.body);
    const contract = await contractService.terminateContract(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { contract });
  })
);

router.post(
  "/:id/variations",
  requirePermission("contracts.variations.create"),
  asyncHandler(async (req, res) => {
    const input = createContractVariationSchema.parse(req.body);
    const contract = await contractService.createVariation(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { contract }, 201);
  })
);

export default router;
