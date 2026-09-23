/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation — API Routes
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { automationService } from "../../services/automation/AutomationService";

export const automationRoutes = Router();

automationRoutes.use(authenticateToken);

// -----------------------------------------------------------------------------
// Validation Schemas
// -----------------------------------------------------------------------------

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().default("GENERAL"),
  triggerType: z.enum(["EVENT", "SCHEDULE", "MANUAL", "API", "CONDITIONAL"]).default("EVENT"),
  triggerConfig: z.record(z.unknown()).default({}),
  conditions: z.unknown().default([]),
  steps: z.array(z.record(z.unknown())).default([]),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(5).default(2),
      backoffMs: z.number().int().min(100).max(60000).default(1000),
      exponential: z.boolean().default(true),
    })
    .optional(),
  limits: z
    .object({
      maxSteps: z.number().int().min(1).max(100).default(50),
      maxDurationMs: z.number().int().min(5000).max(600000).default(300000),
      maxAiCalls: z.number().int().min(0).max(50).default(10),
      maxToolCalls: z.number().int().min(0).max(50).default(15),
      maxLoopIterations: z.number().int().min(1).max(50).default(10),
    })
    .optional(),
});

const UpdateWorkflowSchema = CreateWorkflowSchema.partial().extend({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
});

const TriggerWorkflowSchema = z.object({
  input: z.record(z.unknown()).default({}),
  correlationId: z.string().optional(),
});

const DecideApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedUserId: z.string().optional(),
  assignedRole: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z.string().optional(),
  sourceWorkflowId: z.string().optional(),
  sourceExecutionId: z.string().optional(),
  sourceEntityType: z.string().optional(),
  sourceEntityId: z.string().optional(),
  isAiGenerated: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateTaskSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  assignedUserId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().optional(),
});

const CreateScheduleSchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  scheduleType: z.enum(["ONE_TIME", "RECURRING", "CRON"]).default("RECURRING"),
  cronExpression: z.string().optional(),
  timezone: z.string().default("UTC"),
  intervalSeconds: z.number().int().positive().optional(),
  config: z.record(z.unknown()).optional(),
});

const EmitEventSchema = z.object({
  eventType: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  sourceModule: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
  correlationId: z.string().optional(),
});

const ExecuteActionSchema = z.object({
  actionId: z.string().min(1),
  input: z.record(z.unknown()).default({}),
});

// -----------------------------------------------------------------------------
// Routes: Dashboard & Metrics
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/dashboard",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const data = await automationService.getDashboardMetrics(req.organizationId!);
    sendSuccess(res, data);
  })
);

// -----------------------------------------------------------------------------
// Routes: Workflows
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/workflows",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listWorkflows({
      organizationId: req.organizationId!,
      status: req.query.status as string,
      category: req.query.category as string,
      triggerType: req.query.triggerType as string,
      search: req.query.search as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.post(
  "/workflows",
  requirePermission("automation.create"),
  asyncHandler(async (req, res) => {
    const body = CreateWorkflowSchema.parse(req.body);
    const workflow = await automationService.createWorkflow({
      organizationId: req.organizationId!,
      userId: req.user!.id,
      name: body.name,
      description: body.description,
      category: body.category,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      conditions: body.conditions,
      steps: body.steps as any,
      retryPolicy: body.retryPolicy,
      limits: body.limits,
    });
    sendSuccess(res, { workflow }, 201);
  })
);

automationRoutes.get(
  "/workflows/:id",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const workflow = await automationService.getWorkflow(req.params.id!, req.organizationId!);
    sendSuccess(res, { workflow });
  })
);

automationRoutes.put(
  "/workflows/:id",
  requirePermission("automation.edit"),
  asyncHandler(async (req, res) => {
    const body = UpdateWorkflowSchema.parse(req.body);
    const updated = await automationService.updateWorkflow({
      id: req.params.id!,
      organizationId: req.organizationId!,
      userId: req.user!.id,
      name: body.name,
      description: body.description,
      category: body.category,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      conditions: body.conditions,
      steps: body.steps as any,
      retryPolicy: body.retryPolicy,
      limits: body.limits,
      status: body.status,
    });
    sendSuccess(res, { workflow: updated });
  })
);

automationRoutes.post(
  "/workflows/:id/publish",
  requirePermission("automation.publish"),
  asyncHandler(async (req, res) => {
    const body = z.object({ changeSummary: z.string().optional() }).parse(req.body || {});
    const published = await automationService.publishWorkflow({
      id: req.params.id!,
      organizationId: req.organizationId!,
      userId: req.user!.id,
      changeSummary: body.changeSummary,
    });
    sendSuccess(res, { workflow: published });
  })
);

automationRoutes.get(
  "/workflows/:id/versions",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const versions = await automationService.listWorkflowVersions(req.params.id!, req.organizationId!);
    sendSuccess(res, { versions });
  })
);

automationRoutes.post(
  "/workflows/:id/trigger",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = TriggerWorkflowSchema.parse(req.body || {});
    const result = await automationService.triggerWorkflow({
      workflowId: req.params.id!,
      organizationId: req.organizationId!,
      triggerType: "MANUAL",
      input: body.input,
      userId: req.user!.id,
      correlationId: body.correlationId,
    });
    sendSuccess(res, result, 202);
  })
);

// -----------------------------------------------------------------------------
// Routes: Executions
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/executions",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listExecutions({
      organizationId: req.organizationId!,
      workflowId: req.query.workflowId as string,
      status: req.query.status as string,
      triggerType: req.query.triggerType as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.get(
  "/executions/:id",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const execution = await automationService.getExecution(req.params.id!, req.organizationId!);
    sendSuccess(res, { execution });
  })
);

automationRoutes.post(
  "/executions/:id/retry",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const result = await automationService.retryExecution(req.params.id!, req.organizationId!);
    sendSuccess(res, { execution: result });
  })
);

automationRoutes.post(
  "/executions/:id/cancel",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ reason: z.string().optional() }).parse(req.body || {});
    const result = await automationService.cancelExecution(req.params.id!, req.organizationId!, body.reason);
    sendSuccess(res, { execution: result });
  })
);

// -----------------------------------------------------------------------------
// Routes: Approvals
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/approvals",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listApprovals({
      organizationId: req.organizationId!,
      workflowId: req.query.workflowId as string,
      status: req.query.status as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.post(
  "/approvals/:id/decide",
  requirePermission("automation.approve"),
  asyncHandler(async (req, res) => {
    const body = DecideApprovalSchema.parse(req.body);
    const result = await automationService.decideApproval({
      approvalId: req.params.id!,
      organizationId: req.organizationId!,
      userId: req.user!.id,
      userRole: req.user!.role.key,
      decision: body.decision,
      reason: body.reason,
    });
    sendSuccess(res, result);
  })
);

// -----------------------------------------------------------------------------
// Routes: Tasks
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/tasks",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listTasks({
      organizationId: req.organizationId!,
      status: req.query.status as string,
      priority: req.query.priority as string,
      assignedUserId: req.query.assignedUserId as string,
      sourceWorkflowId: req.query.sourceWorkflowId as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.post(
  "/tasks",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = CreateTaskSchema.parse(req.body);
    const task = await automationService.createTask({
      organizationId: req.organizationId!,
      ...body,
    });
    sendSuccess(res, { task }, 201);
  })
);

automationRoutes.patch(
  "/tasks/:id",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = UpdateTaskSchema.parse(req.body);
    const updated = await automationService.updateTask({
      taskId: req.params.id!,
      organizationId: req.organizationId!,
      userId: req.user!.id,
      ...body,
    });
    sendSuccess(res, { task: updated });
  })
);

// -----------------------------------------------------------------------------
// Routes: Schedules
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/schedules",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
    const result = await automationService.listSchedules({
      organizationId: req.organizationId!,
      workflowId: req.query.workflowId as string,
      isActive,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.post(
  "/schedules",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = CreateScheduleSchema.parse(req.body);
    const schedule = await automationService.createSchedule({
      organizationId: req.organizationId!,
      ...body,
    });
    sendSuccess(res, { schedule }, 201);
  })
);

automationRoutes.patch(
  "/schedules/:id/toggle",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = z.object({ isActive: z.boolean().optional() }).parse(req.body || {});
    const schedule = await automationService.toggleSchedule(
      req.params.id!,
      req.organizationId!,
      body.isActive
    );
    sendSuccess(res, { schedule });
  })
);

automationRoutes.delete(
  "/schedules/:id",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const result = await automationService.deleteSchedule(req.params.id!, req.organizationId!);
    sendSuccess(res, result);
  })
);

// -----------------------------------------------------------------------------
// Routes: Events
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/events/types",
  requirePermission("automation.read"),
  asyncHandler(async (_req, res) => {
    const types = automationService.listRegisteredEventTypes();
    sendSuccess(res, { types });
  })
);

automationRoutes.get(
  "/events",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listEvents({
      organizationId: req.organizationId!,
      eventType: req.query.eventType as string,
      correlationId: req.query.correlationId as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    sendSuccess(res, result);
  })
);

automationRoutes.post(
  "/events",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = EmitEventSchema.parse(req.body);
    const event = await automationService.emitEvent({
      organizationId: req.organizationId!,
      actorId: req.user!.id,
      actorType: "USER",
      ...body,
    });
    sendSuccess(res, { event }, 202);
  })
);

// -----------------------------------------------------------------------------
// Routes: Actions
// -----------------------------------------------------------------------------

automationRoutes.get(
  "/actions",
  requirePermission("automation.read"),
  asyncHandler(async (_req, res) => {
    const actions = automationService.listRegisteredActions();
    sendSuccess(res, { actions });
  })
);

automationRoutes.post(
  "/actions/execute",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = ExecuteActionSchema.parse(req.body);
    const result = await automationService.executeActionDirectly({
      actionId: body.actionId,
      input: body.input,
      organizationId: req.organizationId!,
      userId: req.user!.id,
      userPermissions: req.user!.role.permissions || [],
    });
    sendSuccess(res, { result });
  })
);
