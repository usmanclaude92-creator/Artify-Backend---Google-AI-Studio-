/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Unified Automation Service Facade
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { NotFoundError, ValidationError } from "../../core/errors";
import { ConditionEngine } from "./ConditionEngine";
import { eventEngine } from "./EventEngine";
import { actionRegistry } from "./ActionRegistry";
import { approvalEngine } from "./ApprovalEngine";
import { taskManager } from "./TaskManager";
import { schedulerEngine } from "./SchedulerEngine";
import { workflowEngine } from "./WorkflowEngine";
import { WorkflowValidator } from "./WorkflowValidator";
import {
  BusinessActorType,
  BusinessEventPayload,
  DEFAULT_RETRY_POLICY,
  DEFAULT_WORKFLOW_LIMITS,
  WorkflowLimits,
  WorkflowRetryPolicy,
  WorkflowStepConfig,
  WorkflowTriggerConfig,
  WorkflowTriggerType,
} from "./types";

export class AutomationService {
  private static instance: AutomationService;

  private constructor() {
    this.initEventListeners();
    this.initSchedulerIntegration();
  }

  public static getInstance(): AutomationService {
    if (!AutomationService.instance) {
      AutomationService.instance = new AutomationService();
    }
    return AutomationService.instance;
  }

  /**
   * Automatically dispatches business events to matching active workflows.
   */
  private initEventListeners(): void {
    eventEngine.subscribe(async (event: BusinessEventPayload) => {
      try {
        const workflows = await prisma.automationWorkflow.findMany({
          where: {
            organizationId: event.organizationId,
            status: "ACTIVE",
            triggerType: "EVENT",
          },
        });

        for (const wf of workflows) {
          const cfg = (wf.triggerConfig || {}) as { eventType?: string; filterCondition?: any };
          if (cfg.eventType === event.eventType || cfg.eventType === "*") {
            // Check optional filter condition
            if (cfg.filterCondition) {
              const matches = ConditionEngine.evaluate(cfg.filterCondition, {
                event: event.eventType,
                entityType: event.entityType,
                entityId: event.entityId,
                payload: event.payload,
              });
              if (!matches) continue;
            }

            logger.info(
              { workflowId: wf.id, eventType: event.eventType, correlationId: event.correlationId },
              "[AutomationService] Event triggered matching workflow execution"
            );

            await workflowEngine.enqueueExecution({
              workflowId: wf.id,
              organizationId: event.organizationId,
              triggerType: "EVENT",
              triggerEventId: event.eventId,
              entityType: event.entityType,
              entityId: event.entityId,
              input: event.payload as Record<string, unknown>,
              correlationId: event.correlationId,
              idempotencyKey: `event:${event.eventId}:${wf.id}`,
            });
          }
        }
      } catch (err) {
        logger.error({ err, eventId: event.eventId }, "[AutomationService] Error routing event to workflows");
      }
    });
  }

  /**
   * Connect scheduler ticks to workflow execution.
   */
  private initSchedulerIntegration(): void {
    schedulerEngine.setWorkflowExecutor(async (params) => {
      return workflowEngine.enqueueExecution({
        workflowId: params.workflowId,
        organizationId: params.organizationId,
        triggerType: "SCHEDULE",
        input: params.input,
        correlationId: params.correlationId,
      });
    });
    schedulerEngine.start();
    workflowEngine.startWorker();
  }

  // ---------------------------------------------------------------------------
  // Workflows Lifecycle & Management
  // ---------------------------------------------------------------------------

  public async createWorkflow(params: {
    organizationId: string;
    userId?: string;
    name: string;
    description?: string;
    category?: string;
    triggerType: WorkflowTriggerType;
    triggerConfig?: WorkflowTriggerConfig;
    conditions?: unknown;
    steps?: WorkflowStepConfig[];
    retryPolicy?: WorkflowRetryPolicy;
    limits?: WorkflowLimits;
  }) {
    const id = crypto.randomUUID();

    const workflow = await prisma.automationWorkflow.create({
      data: {
        id,
        organizationId: params.organizationId,
        name: params.name,
        description: params.description || null,
        category: params.category || "GENERAL",
        status: "DRAFT",
        currentVersion: 1,
        triggerType: params.triggerType,
        triggerConfig: (params.triggerConfig || {}) as any,
        conditions: (params.conditions || []) as any,
        steps: (params.steps || []) as any,
        retryPolicy: (params.retryPolicy || DEFAULT_RETRY_POLICY) as any,
        limits: (params.limits || DEFAULT_WORKFLOW_LIMITS) as any,
        createdById: params.userId || null,
        updatedById: params.userId || null,
      },
    });

    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_WORKFLOW_CREATED",
        resourceType: "automation_workflow",
        resourceId: workflow.id,
        metadata: { name: workflow.name, triggerType: workflow.triggerType },
      });
    }

    return workflow;
  }

  public async updateWorkflow(params: {
    id: string;
    organizationId: string;
    userId?: string;
    name?: string;
    description?: string;
    category?: string;
    triggerType?: WorkflowTriggerType;
    triggerConfig?: WorkflowTriggerConfig;
    conditions?: unknown;
    steps?: WorkflowStepConfig[];
    retryPolicy?: WorkflowRetryPolicy;
    limits?: WorkflowLimits;
    status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  }) {
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
    });

    if (!existing) {
      throw new NotFoundError("Workflow not found.");
    }

    const updateData: Record<string, any> = {
      updatedById: params.userId || null,
    };
    if (params.name !== undefined) updateData.name = params.name;
    if (params.description !== undefined) updateData.description = params.description;
    if (params.category !== undefined) updateData.category = params.category;
    if (params.triggerType !== undefined) updateData.triggerType = params.triggerType;
    if (params.triggerConfig !== undefined) updateData.triggerConfig = params.triggerConfig;
    if (params.conditions !== undefined) updateData.conditions = params.conditions;
    if (params.steps !== undefined) updateData.steps = params.steps;
    if (params.retryPolicy !== undefined) updateData.retryPolicy = params.retryPolicy;
    if (params.limits !== undefined) updateData.limits = params.limits;
    if (params.status !== undefined) updateData.status = params.status;

    // If updating a published workflow, bump version
    if (existing.publishedVersion && params.steps !== undefined) {
      updateData.currentVersion = (existing.currentVersion || 1) + 1;
    }

    const updated = await prisma.automationWorkflow.update({
      where: { id: existing.id },
      data: updateData,
    });

    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_WORKFLOW_UPDATED",
        resourceType: "automation_workflow",
        resourceId: updated.id,
      });
    }

    return updated;
  }

  /**
   * Publishes a workflow:
   * 1. Validates definition against strict rules
   * 2. Saves snapshot to automation_workflow_versions
   * 3. Sets publishedVersion and activates workflow
   */
  public async publishWorkflow(params: {
    id: string;
    organizationId: string;
    userId?: string;
    changeSummary?: string;
  }) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: params.id, organizationId: params.organizationId },
    });

    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }

    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as WorkflowStepConfig[];

    // 1. Strict Validation
    const validation = await WorkflowValidator.validate({
      organizationId: params.organizationId,
      name: workflow.name,
      triggerType: workflow.triggerType as WorkflowTriggerType,
      triggerConfig: workflow.triggerConfig as WorkflowTriggerConfig,
      conditions: workflow.conditions,
      steps,
      limits: workflow.limits as any,
      retryPolicy: workflow.retryPolicy as any,
    });

    if (!validation.isValid) {
      throw new ValidationError(`Cannot publish invalid workflow:\n${validation.errors.join("\n")}`);
    }

    const newVersionNumber = (workflow.publishedVersion || 0) + 1;

    // 2. Create immutable Version Snapshot
    await prisma.automationWorkflowVersion.create({
      data: {
        id: crypto.randomUUID(),
        workflowId: workflow.id,
        version: newVersionNumber,
        name: workflow.name,
        description: workflow.description || null,
        category: workflow.category,
        triggerType: workflow.triggerType,
        triggerConfig: workflow.triggerConfig as any,
        conditions: workflow.conditions as any,
        steps: workflow.steps as any,
        retryPolicy: workflow.retryPolicy as any,
        limits: workflow.limits as any,
        publishedById: params.userId || null,
        changeSummary: params.changeSummary || `Published version ${newVersionNumber}`,
      },
    });

    // 3. Update main workflow
    const published = await prisma.automationWorkflow.update({
      where: { id: workflow.id },
      data: {
        publishedVersion: newVersionNumber,
        currentVersion: newVersionNumber,
        status: "ACTIVE",
        updatedById: params.userId || null,
      },
    });

    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.userId || null,
      actorType: params.userId ? "USER" : "SYSTEM",
      action: "AUTOMATION_WORKFLOW_PUBLISHED",
      resourceType: "automation_workflow",
      resourceId: workflow.id,
      metadata: { version: newVersionNumber },
    });

    return published;
  }

  public async getWorkflow(id: string, organizationId: string) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id, organizationId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 10,
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }
    return workflow;
  }

  public async listWorkflows(params: {
    organizationId: string;
    status?: string;
    category?: string;
    triggerType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.triggerType) where.triggerType = params.triggerType;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.automationWorkflow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          _count: {
            select: { executions: true, schedules: true },
          },
        },
      }),
      prisma.automationWorkflow.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  public async listWorkflowVersions(workflowId: string, organizationId: string) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: workflowId, organizationId },
    });
    if (!workflow) throw new NotFoundError("Workflow not found.");

    return prisma.automationWorkflowVersion.findMany({
      where: { workflowId },
      orderBy: { version: "desc" },
      include: {
        publishedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Executions
  // ---------------------------------------------------------------------------

  public async triggerWorkflow(params: {
    workflowId: string;
    organizationId: string;
    triggerType?: WorkflowTriggerType;
    input?: Record<string, unknown>;
    userId?: string;
    correlationId?: string;
  }) {
    return workflowEngine.enqueueExecution({
      workflowId: params.workflowId,
      organizationId: params.organizationId,
      triggerType: params.triggerType || "MANUAL",
      input: params.input || {},
      initiatedById: params.userId,
      correlationId: params.correlationId,
    });
  }

  public async getExecution(id: string, organizationId: string) {
    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId },
      include: {
        workflow: {
          select: { id: true, name: true, category: true, steps: true },
        },
        stepExecutions: {
          orderBy: { stepIndex: "asc" },
        },
        approvals: true,
        actionExecutions: true,
        notifications: true,
        tasks: true,
      },
    });

    if (!execution) {
      throw new NotFoundError("Execution not found.");
    }
    return execution;
  }

  public async listExecutions(params: {
    organizationId: string;
    workflowId?: string;
    status?: string;
    triggerType?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.workflowId) where.workflowId = params.workflowId;
    if (params.status) where.status = params.status;
    if (params.triggerType) where.triggerType = params.triggerType;

    const [rows, total] = await Promise.all([
      prisma.automationExecution.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          workflow: {
            select: { id: true, name: true, category: true },
          },
          _count: {
            select: { stepExecutions: true, approvals: true, tasks: true },
          },
        },
      }),
      prisma.automationExecution.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  public async retryExecution(id: string, organizationId: string) {
    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId },
    });

    if (!execution) throw new NotFoundError("Execution not found.");
    if (execution.status !== "FAILED") {
      throw new ValidationError(`Only failed executions can be retried (current status: ${execution.status}).`);
    }

    await prisma.automationExecution.update({
      where: { id },
      data: {
        status: "QUEUED",
        errorMessage: null,
      },
    });

    return workflowEngine.execute(id);
  }

  public async cancelExecution(id: string, organizationId: string, reason?: string) {
    return workflowEngine.cancelExecution(id, organizationId, reason);
  }

  // ---------------------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------------------

  public async listApprovals(params: {
    organizationId: string;
    status?: string;
    workflowId?: string;
    page?: number;
    limit?: number;
  }) {
    return approvalEngine.listApprovals(params);
  }

  public async decideApproval(params: {
    approvalId: string;
    organizationId: string;
    userId: string;
    userRole: string;
    decision: "APPROVED" | "REJECTED";
    reason?: string;
  }) {
    const result = await approvalEngine.decideApproval(params);

    if (result.executionResumed && result.approval.executionId) {
      // Resume workflow execution
      setImmediate(() => {
        workflowEngine.resumeExecution(result.approval.executionId, params.organizationId).catch((err) => {
          logger.error({ err, executionId: result.approval.executionId }, "[AutomationService] Resume after approval failed");
        });
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  public async listTasks(params: {
    organizationId: string;
    status?: string;
    priority?: string;
    assignedUserId?: string;
    sourceWorkflowId?: string;
    page?: number;
    limit?: number;
  }) {
    return taskManager.listTasks(params);
  }

  public async createTask(params: {
    organizationId: string;
    title: string;
    description?: string;
    assignedUserId?: string;
    assignedRole?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: string | Date;
    sourceWorkflowId?: string;
    sourceExecutionId?: string;
    sourceEntityType?: string;
    sourceEntityId?: string;
    isAiGenerated?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    return taskManager.createTask(params);
  }

  public async updateTask(params: {
    taskId: string;
    organizationId: string;
    userId?: string;
    status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    assignedUserId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: string | Date;
  }) {
    return taskManager.updateTask(params);
  }

  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------

  public async listSchedules(params: {
    organizationId: string;
    workflowId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    return schedulerEngine.listSchedules(params);
  }

  public async createSchedule(params: {
    organizationId: string;
    workflowId: string;
    name: string;
    description?: string;
    scheduleType: "ONE_TIME" | "RECURRING" | "CRON";
    cronExpression?: string;
    timezone?: string;
    intervalSeconds?: number;
    config?: Record<string, unknown>;
  }) {
    return schedulerEngine.createSchedule(params);
  }

  public async toggleSchedule(id: string, organizationId: string, isActive?: boolean) {
    return schedulerEngine.toggleSchedule(id, organizationId, isActive);
  }

  public async deleteSchedule(id: string, organizationId: string) {
    return schedulerEngine.deleteSchedule(id, organizationId);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  public async emitEvent<T extends Record<string, unknown>>(params: {
    eventType: string;
    entityType: string;
    entityId: string;
    organizationId: string;
    actorId?: string;
    actorType?: BusinessActorType;
    sourceModule?: string;
    payload: T;
    correlationId?: string;
  }) {
    return eventEngine.emit(params);
  }

  public listRegisteredEventTypes() {
    return eventEngine.listRegisteredEvents();
  }

  public async listEvents(params: {
    organizationId: string;
    eventType?: string;
    correlationId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.eventType) where.eventType = params.eventType;
    if (params.correlationId) where.correlationId = params.correlationId;

    const [rows, total] = await Promise.all([
      prisma.automationEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.automationEvent.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  public listRegisteredActions() {
    return actionRegistry.listActions();
  }

  public async executeActionDirectly(params: {
    actionId: string;
    input: Record<string, unknown>;
    organizationId: string;
    userId?: string;
    userPermissions: readonly string[];
  }) {
    return actionRegistry.executeAction({
      actionId: params.actionId,
      input: params.input,
      organizationId: params.organizationId,
      userId: params.userId,
      userPermissions: params.userPermissions,
      correlationId: crypto.randomUUID(),
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Analytics
  // ---------------------------------------------------------------------------

  public async getDashboardMetrics(organizationId: string) {
    const [
      totalWorkflows,
      activeWorkflows,
      totalExecutions,
      completedExecutions,
      failedExecutions,
      runningExecutions,
      pendingApprovals,
      activeTasks,
      recentExecutions,
    ] = await Promise.all([
      prisma.automationWorkflow.count({ where: { organizationId } }),
      prisma.automationWorkflow.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.automationExecution.count({ where: { organizationId } }),
      prisma.automationExecution.count({ where: { organizationId, status: "COMPLETED" } }),
      prisma.automationExecution.count({ where: { organizationId, status: "FAILED" } }),
      prisma.automationExecution.count({ where: { organizationId, status: { in: ["RUNNING", "QUEUED", "WAITING_APPROVAL"] } } }),
      prisma.automationApproval.count({ where: { organizationId, status: "PENDING" } }),
      prisma.automationTask.count({ where: { organizationId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.automationExecution.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          workflow: { select: { id: true, name: true, category: true } },
        },
      }),
    ]);

    const successRate = totalExecutions > 0
      ? Math.round((completedExecutions / totalExecutions) * 100)
      : 100;

    return {
      metrics: {
        totalWorkflows,
        activeWorkflows,
        totalExecutions,
        completedExecutions,
        failedExecutions,
        runningExecutions,
        pendingApprovals,
        activeTasks,
        successRate,
      },
      recentExecutions,
    };
  }
}

export const automationService = AutomationService.getInstance();
