/**
 * AI Control Center API Routes (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Organization-scoped, RBAC-guarded routes for AI management and orchestration.
 */
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { aiService } from "../../services/ai/AiService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import {
  listAiQuerySchema,
  createAiProviderSchema,
  updateAiProviderSchema,
  createAiModelSchema,
  updateAiModelSchema,
  createAiAgentSchema,
  updateAiAgentSchema,
  createAiPromptSchema,
  updateAiPromptSchema,
  createAiWorkflowSchema,
  updateAiWorkflowSchema,
  executePromptSchema,
  executeWorkflowSchema,
  decideApprovalSchema,
  executeToolSchema,
} from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

// -----------------------------------------------------------------------------
// Capabilities & Overview
// -----------------------------------------------------------------------------
router.get(
  "/capabilities",
  requirePermission("ai.read"),
  asyncHandler(async (_req, res) => {
    const capabilities = aiService.getCapabilities();
    sendSuccess(res, { capabilities });
  })
);

router.get(
  "/capabilities/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const capability = aiService.getCapabilityDetails(req.params.id!);
    sendSuccess(res, { capability });
  })
);

router.get(
  "/dashboard",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const stats = await aiService.getDashboard(req.organizationId!);
    sendSuccess(res, { stats });
  })
);

// -----------------------------------------------------------------------------
// Providers
// -----------------------------------------------------------------------------
router.get(
  "/providers",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const providers = await aiService.listProviders(req.organizationId!);
    sendSuccess(res, { providers });
  })
);

router.get(
  "/providers/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const provider = await aiService.getProvider(req.params.id!, req.organizationId!);
    sendSuccess(res, { provider });
  })
);

router.post(
  "/providers",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiProviderSchema.parse(req.body);
    const provider = await aiService.createProvider(
      req.organizationId!,
      input as unknown as Prisma.AiProviderUncheckedCreateInput
    );
    sendSuccess(res, { provider }, 201);
  })
);

router.patch(
  "/providers/:id",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiProviderSchema.parse(req.body);
    const provider = await aiService.updateProvider(
      req.params.id!,
      req.organizationId!,
      input as unknown as Prisma.AiProviderUncheckedUpdateInput
    );
    sendSuccess(res, { provider });
  })
);

router.delete(
  "/providers/:id",
  requirePermission("ai.admin"),
  asyncHandler(async (req, res) => {
    await aiService.deleteProvider(req.params.id!, req.organizationId!);
    sendSuccess(res, { message: "Provider deleted successfully." });
  })
);

router.post(
  "/providers/:id/test",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const result = await aiService.testProvider(req.params.id!, req.organizationId!);
    sendSuccess(res, { result });
  })
);

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------
router.get(
  "/models",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const providerId = req.query.providerId ? String(req.query.providerId) : undefined;
    const models = await aiService.listModels(providerId);
    sendSuccess(res, { models });
  })
);

router.get(
  "/models/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const model = await aiService.getModel(req.params.id!);
    sendSuccess(res, { model });
  })
);

router.post(
  "/models",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiModelSchema.parse(req.body);
    const model = await aiService.createModel(input as unknown as Prisma.AiModelUncheckedCreateInput);
    sendSuccess(res, { model }, 201);
  })
);

router.patch(
  "/models/:id",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiModelSchema.parse(req.body);
    const model = await aiService.updateModel(req.params.id!, input as unknown as Prisma.AiModelUncheckedUpdateInput);
    sendSuccess(res, { model });
  })
);

// -----------------------------------------------------------------------------
// Agents
// -----------------------------------------------------------------------------
router.get(
  "/agents",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const query = listAiQuerySchema.parse(req.query);
    const { rows, total } = await aiService.listAgents(req.organizationId!, query, query.page, query.limit);
    sendSuccess(res, { agents: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/agents/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const agent = await aiService.getAgent(req.params.id!, req.organizationId!);
    sendSuccess(res, { agent });
  })
);

router.get(
  "/agents/:id/versions",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const versions = await aiService.listAgentVersions(req.params.id!, req.organizationId!);
    sendSuccess(res, { versions });
  })
);

router.post(
  "/agents",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiAgentSchema.parse(req.body);
    const agent = await aiService.createAgent(
      req.organizationId!,
      req.user!.id,
      input as unknown as Prisma.AiAgentUncheckedCreateInput
    );
    sendSuccess(res, { agent }, 201);
  })
);

router.patch(
  "/agents/:id",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiAgentSchema.parse(req.body);
    const { changeNote, ...rest } = input;
    const agent = await aiService.updateAgent(
      req.params.id!,
      req.organizationId!,
      req.user!.id,
      rest as unknown as Prisma.AiAgentUncheckedUpdateInput,
      changeNote
    );
    sendSuccess(res, { agent });
  })
);

// -----------------------------------------------------------------------------
// Prompts
// -----------------------------------------------------------------------------
router.get(
  "/prompts",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const query = listAiQuerySchema.parse(req.query);
    const { rows, total } = await aiService.listPrompts(req.organizationId!, query, query.page, query.limit);
    sendSuccess(res, { prompts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/prompts/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const prompt = await aiService.getPrompt(req.params.id!, req.organizationId!);
    sendSuccess(res, { prompt });
  })
);

router.get(
  "/prompts/:id/versions",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const versions = await aiService.listPromptVersions(req.params.id!, req.organizationId!);
    sendSuccess(res, { versions });
  })
);

router.post(
  "/prompts",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiPromptSchema.parse(req.body);
    const prompt = await aiService.createPrompt(
      req.organizationId!,
      req.user!.id,
      input as unknown as Prisma.AiPromptUncheckedCreateInput
    );
    sendSuccess(res, { prompt }, 201);
  })
);

router.patch(
  "/prompts/:id",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiPromptSchema.parse(req.body);
    const { changeNote, ...rest } = input;
    const prompt = await aiService.updatePrompt(
      req.params.id!,
      req.organizationId!,
      req.user!.id,
      rest as unknown as Prisma.AiPromptUncheckedUpdateInput,
      changeNote
    );
    sendSuccess(res, { prompt });
  })
);

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------
router.get(
  "/tools",
  requirePermission("ai.read"),
  asyncHandler(async (_req, res) => {
    const tools = aiService.listTools();
    sendSuccess(res, { tools });
  })
);

router.post(
  "/tools/execute",
  requirePermission("ai.use"),
  asyncHandler(async (req, res) => {
    const input = executeToolSchema.parse(req.body);
    const result = await aiService.executeTool(input.toolName, input.args, {
      organizationId: req.organizationId!,
      userId: req.user!.id,
      userPermissions: req.user!.role.permissions,
    });
    sendSuccess(res, { result });
  })
);

// -----------------------------------------------------------------------------
// Workflows
// -----------------------------------------------------------------------------
router.get(
  "/workflows",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const query = listAiQuerySchema.parse(req.query);
    const { rows, total } = await aiService.listWorkflows(req.organizationId!, query, query.page, query.limit);
    sendSuccess(res, { workflows: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/workflows/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const workflow = await aiService.getWorkflow(req.params.id!, req.organizationId!);
    sendSuccess(res, { workflow });
  })
);

router.post(
  "/workflows",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiWorkflowSchema.parse(req.body);
    const workflow = await aiService.createWorkflow(
      req.organizationId!,
      req.user!.id,
      input as unknown as Prisma.AiWorkflowUncheckedCreateInput
    );
    sendSuccess(res, { workflow }, 201);
  })
);

router.patch(
  "/workflows/:id",
  requirePermission("ai.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiWorkflowSchema.parse(req.body);
    const workflow = await aiService.updateWorkflow(
      req.params.id!,
      req.organizationId!,
      req.user!.id,
      input as unknown as Prisma.AiWorkflowUncheckedUpdateInput
    );
    sendSuccess(res, { workflow });
  })
);

router.post(
  "/workflows/:id/execute",
  requirePermission("ai.use"),
  asyncHandler(async (req, res) => {
    const input = executeWorkflowSchema.parse(req.body);
    const result = await aiService.executeWorkflow(
      req.params.id!,
      req.organizationId!,
      req.user!.id,
      req.user!.role.permissions,
      input.input
    );
    sendSuccess(res, { result });
  })
);

// -----------------------------------------------------------------------------
// Approvals & Human Gates
// -----------------------------------------------------------------------------
router.get(
  "/approvals",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const { rows, total } = await aiService.listApprovals(req.organizationId!, status, page, limit);
    sendSuccess(res, { approvals: rows }, 200, { page, limit, total });
  })
);

router.get(
  "/approvals/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const approval = await aiService.getApproval(req.params.id!, req.organizationId!);
    sendSuccess(res, { approval });
  })
);

router.post(
  "/approvals/:id/decide",
  requirePermission("ai.approve"),
  asyncHandler(async (req, res) => {
    const input = decideApprovalSchema.parse(req.body);
    const result = await aiService.decideApproval(
      req.params.id!,
      req.organizationId!,
      req.user!.id,
      req.user!.role.permissions,
      input.decision,
      input.reason
    );
    sendSuccess(res, result);
  })
);

// -----------------------------------------------------------------------------
// Executions & Direct Generation
// -----------------------------------------------------------------------------
router.get(
  "/executions",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const query = listAiQuerySchema.parse(req.query);
    const { rows, total } = await aiService.listExecutions(req.organizationId!, query, query.page, query.limit);
    sendSuccess(res, { executions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/executions/:id",
  requirePermission("ai.read"),
  asyncHandler(async (req, res) => {
    const execution = await aiService.getExecution(req.params.id!, req.organizationId!);
    sendSuccess(res, { execution });
  })
);

router.post(
  "/execute",
  requirePermission("ai.use"),
  asyncHandler(async (req, res) => {
    const input = executePromptSchema.parse(req.body);
    const result = await aiService.executePrompt(
      req.organizationId!,
      req.user!.id,
      req.user!.role.permissions,
      input
    );
    sendSuccess(res, { result });
  })
);

export default router;
