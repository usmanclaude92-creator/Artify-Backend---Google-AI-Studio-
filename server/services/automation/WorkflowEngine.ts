/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Robust Workflow Execution & Background Queue Engine
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { ConditionEngine } from "./ConditionEngine";
import { actionRegistry } from "./ActionRegistry";
import { approvalEngine } from "./ApprovalEngine";
import { notificationEngine } from "./NotificationEngine";
import { aiToolExecutor } from "../../ai/tools";
import { aiOrchestrator } from "../ai/AiOrchestrator";
import {
  DEFAULT_WORKFLOW_LIMITS,
  DEFAULT_RETRY_POLICY,
  StructuredAiDecisionSchema,
  WorkflowLimits,
  WorkflowRetryPolicy,
  WorkflowStepConfig,
  WorkflowTriggerType,
} from "./types";

export class WorkflowEngine {
  private static instance: WorkflowEngine;
  private queueInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;

  private constructor() {}

  public static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  /**
   * Starts background worker that processes QUEUED executions.
   */
  public startWorker(intervalMs = 2000): void {
    if (this.queueInterval) return;
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        logger.error({ err }, "[WorkflowEngine] Queue worker processing error");
      });
    }, intervalMs);
    this.queueInterval.unref();
  }

  public stopWorker(): void {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }

  /**
   * Enqueues an execution for background worker processing.
   */
  public async enqueueExecution(params: {
    workflowId: string;
    organizationId: string;
    triggerType: WorkflowTriggerType;
    triggerEventId?: string;
    entityType?: string;
    entityId?: string;
    input?: Record<string, unknown>;
    correlationId?: string;
    initiatedById?: string;
    idempotencyKey?: string;
  }): Promise<{ executionId: string; status: string }> {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: params.workflowId, organizationId: params.organizationId },
    });

    if (!workflow) {
      throw new Error(`Workflow ${params.workflowId} not found.`);
    }

    if (workflow.status !== "ACTIVE") {
      throw new Error(`Workflow "${workflow.name}" is not active (status: ${workflow.status}).`);
    }

    const correlationId = params.correlationId || crypto.randomUUID();
    const versionToRun = workflow.publishedVersion || workflow.currentVersion;
    const executionId = crypto.randomUUID();

    // Check idempotency if key provided
    if (params.idempotencyKey) {
      const existing = await prisma.automationExecution.findFirst({
        where: {
          organizationId: params.organizationId,
          idempotencyKey: params.idempotencyKey,
          status: { in: ["COMPLETED", "RUNNING", "WAITING_APPROVAL"] },
        },
      });

      if (existing) {
        logger.info(
          { idempotencyKey: params.idempotencyKey, existingId: existing.id },
          "[WorkflowEngine] Idempotent execution already exists, returning existing"
        );
        return { executionId: existing.id, status: existing.status };
      }
    }

    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as WorkflowStepConfig[];

    await prisma.automationExecution.create({
      data: {
        id: executionId,
        organizationId: params.organizationId,
        workflowId: workflow.id,
        workflowVersion: versionToRun,
        status: "QUEUED",
        triggerType: params.triggerType,
        triggerEventId: params.triggerEventId || null,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        correlationId,
        idempotencyKey: params.idempotencyKey || null,
        input: (params.input || {}) as any,
        output: {},
        context: (params.input || {}) as any,
        currentStepIndex: 0,
        totalSteps: steps.length,
        initiatedById: params.initiatedById || null,
      },
    });

    // Fire off async step execution immediately
    setImmediate(() => {
      this.execute(executionId).catch((err) => {
        logger.error({ err, executionId }, "[WorkflowEngine] Background run error");
      });
    });

    return { executionId, status: "QUEUED" };
  }

  /**
   * Process pending queued jobs in batch.
   */
  public async processQueue(): Promise<number> {
    if (this.isProcessingQueue) return 0;
    this.isProcessingQueue = true;

    try {
      const queuedJobs = await prisma.automationExecution.findMany({
        where: { status: "QUEUED" },
        take: 5,
        orderBy: { createdAt: "asc" },
      });

      for (const job of queuedJobs) {
        await this.execute(job.id);
      }

      return queuedJobs.length;
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Core workflow execution loop.
   */
  public async execute(executionId: string): Promise<any> {
    const execution = await prisma.automationExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });

    if (!execution) return null;
    if (execution.status === "COMPLETED" || execution.status === "CANCELLED") {
      return execution;
    }

    const workflow = execution.workflow;
    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as WorkflowStepConfig[];
    const limits: WorkflowLimits = {
      ...DEFAULT_WORKFLOW_LIMITS,
      ...((workflow.limits as Record<string, unknown>) || {}),
    };
    const retryPolicy: WorkflowRetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...((workflow.retryPolicy as Record<string, unknown>) || {}),
    };

    // Update state to RUNNING
    const startTime = execution.startedAt ? new Date(execution.startedAt).getTime() : Date.now();
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: "RUNNING", startedAt: new Date(startTime) },
    });

    let context: Record<string, unknown> = {
      ...(execution.context as Record<string, unknown> || {}),
      input: execution.input,
      trigger: {
        type: execution.triggerType,
        eventId: execution.triggerEventId,
        entityType: execution.entityType,
        entityId: execution.entityId,
        correlationId: execution.correlationId,
      },
    };

    let aiCallCount = 0;
    let toolCallCount = 0;
    let stepCount = 0;
    let currentStepIdx = execution.currentStepIndex || 0;

    while (currentStepIdx < steps.length) {
      const step = steps[currentStepIdx];
      stepCount++;

      // 1. Resource Limits & Safeguard Checks
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > limits.maxDurationMs) {
        return this.failExecution(executionId, execution.organizationId, `Execution timed out after ${elapsedMs}ms.`);
      }

      if (stepCount > limits.maxSteps) {
        return this.failExecution(executionId, execution.organizationId, `Exceeded maximum allowed workflow steps (${limits.maxSteps}).`);
      }

      // 2. Prepare Step Execution record
      const stepExecutionId = crypto.randomUUID();
      const stepStartTime = Date.now();

      await prisma.automationStepExecution.create({
        data: {
          id: stepExecutionId,
          executionId,
          stepIndex: currentStepIdx,
          stepId: step.id,
          stepName: step.name,
          stepType: step.type as any,
          status: "RUNNING",
          input: context as any,
          startedAt: new Date(stepStartTime),
        },
      });

      try {
        let stepOutput: Record<string, unknown> = {};
        let nextStepIdx = currentStepIdx + 1;

        // 3. Step Execution by Type
        switch (step.type) {
          case "CONDITION": {
            const matches = ConditionEngine.evaluate(step.condition, context);
            stepOutput = { conditionMet: matches };

            if (matches && step.thenStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.thenStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            } else if (!matches && step.elseStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.elseStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            }
            break;
          }

          case "AI_DECISION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }

            const interpolatedPrompt = this.interpolate(step.prompt, context);
            const promptResult = await aiOrchestrator.execute({
              organizationId: execution.organizationId,
              userId: execution.initiatedById || "system",
              userPermissions: ["*"],
              agentId: step.agentId || undefined,
              prompt: `${interpolatedPrompt}\n\nYou MUST respond strictly in valid JSON matching this schema:\n{\n  "decision": "APPROVED" | "REJECTED" | "REVIEW_REQUIRED" | "FLAGGED",\n  "reason": "explanation string",\n  "confidence": number between 0 and 1,\n  "recommended_action": "action_string"\n}`,
              capability: "TEXT_GENERATION",
              temperature: 0.1,
            });

            // Extract and validate structured AI output
            const rawContent = (promptResult.output || "").trim();
            let parsedJson: unknown;
            try {
              const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
              parsedJson = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
            } catch {
              parsedJson = {
                decision: "REVIEW_REQUIRED",
                reason: `AI output was not strictly valid JSON: ${rawContent.slice(0, 100)}`,
                confidence: 0.5,
                recommended_action: "MANUAL_REVIEW",
              };
            }

            const validated = StructuredAiDecisionSchema.safeParse(parsedJson);
            if (!validated.success) {
              stepOutput = {
                decision: "REVIEW_REQUIRED",
                reason: "AI output failed schema validation",
                confidence: 0.5,
                raw: rawContent,
              };
            } else {
              stepOutput = validated.data as Record<string, unknown>;
            }
            context[step.id] = stepOutput;
            break;
          }

          case "AI_GENERATION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }

            const interpolatedPrompt = this.interpolate(step.prompt, context);
            const genResult = await aiOrchestrator.execute({
              organizationId: execution.organizationId,
              userId: execution.initiatedById || "system",
              userPermissions: ["*"],
              agentId: step.agentId || undefined,
              prompt: interpolatedPrompt,
              capability: "TEXT_GENERATION",
              useKnowledgeBase: step.useKnowledgeBase,
              knowledgeFilter: step.knowledgeFilter,
            });

            stepOutput = { generatedText: genResult.output, citations: genResult.citations };
            context[step.outputKey || step.id] = genResult.output;
            break;
          }

          case "TOOL_CALL": {
            toolCallCount++;
            if (toolCallCount > limits.maxToolCalls) {
              throw new Error(`Exceeded maximum allowed tool calls (${limits.maxToolCalls}).`);
            }

            const toolArgs = this.interpolateObject(step.argumentsTemplate, context);
            const toolResult = await aiToolExecutor.executeTool(
              step.toolName,
              toolArgs,
              {
                organizationId: execution.organizationId,
                userId: execution.initiatedById || undefined,
                userPermissions: ["*"],
                agentName: "Autonomous Workflow Engine",
              }
            );

            stepOutput = (toolResult.data || {}) as Record<string, unknown>;
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          case "BUSINESS_ACTION": {
            // Check if action requires approval
            if (step.requireApproval) {
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: step.actionId,
                description: `Human approval required for action "${step.actionId}"`,
                payload: { parameters: step.parameters, context: context[step.id] || {} },
              });

              // Pause workflow in WAITING_APPROVAL
              await prisma.automationExecution.update({
                where: { id: executionId },
                data: {
                  status: "WAITING_APPROVAL",
                  currentStepIndex: currentStepIdx,
                  context: context as any,
                },
              });

              await prisma.automationStepExecution.update({
                where: { id: stepExecutionId },
                data: { status: "WAITING_APPROVAL" },
              });

              logger.info({ executionId, stepId: step.id }, "[WorkflowEngine] Paused for human approval");
              return { executionId, status: "WAITING_APPROVAL" };
            }

            const actionParams = this.interpolateObject(step.parameters, context);
            const idempotencyKey = `${workflow.id}:${execution.workflowVersion}:${execution.correlationId}:${step.id}`;

            const actionOutput = await actionRegistry.executeAction({
              actionId: step.actionId,
              input: actionParams,
              organizationId: execution.organizationId,
              userId: execution.initiatedById || undefined,
              userPermissions: ["*"],
              workflowId: workflow.id,
              executionId,
              stepId: step.id,
              correlationId: execution.correlationId,
              idempotencyKey,
            });

            stepOutput = actionOutput;
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          case "APPROVAL": {
            // Explicit human-in-the-loop gate step
            const pendingApproval = await prisma.automationApproval.findFirst({
              where: {
                executionId,
                stepId: step.id,
                status: "APPROVED",
              },
            });

            if (!pendingApproval) {
              // Not yet approved; create approval and pause
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: "APPROVAL_GATE",
                description: this.interpolate(step.actionDescription, context),
                requiredRole: step.requiredRole,
                payload: { contextSummary: context },
                timeoutMinutes: step.timeoutMinutes,
              });

              await prisma.automationExecution.update({
                where: { id: executionId },
                data: {
                  status: "WAITING_APPROVAL",
                  currentStepIndex: currentStepIdx,
                  context: context as any,
                },
              });

              await prisma.automationStepExecution.update({
                where: { id: stepExecutionId },
                data: { status: "WAITING_APPROVAL" },
              });

              return { executionId, status: "WAITING_APPROVAL" };
            }

            // If already approved, proceed!
            stepOutput = { approved: true, approverId: pendingApproval.approverId };
            break;
          }

          case "NOTIFICATION": {
            const title = this.interpolate(step.titleTemplate, context);
            const message = this.interpolate(step.messageTemplate, context);
            const targetUserId = step.recipientUserId
              ? this.interpolate(step.recipientUserId, context)
              : undefined;

            const notifResult = await notificationEngine.dispatchNotification({
              organizationId: execution.organizationId,
              userId: targetUserId,
              recipientRole: step.recipientRole,
              channel: step.channel,
              title,
              message,
              level: step.level || "INFO",
              sourceWorkflowId: workflow.id,
              sourceExecutionId: executionId,
            });

            stepOutput = notifResult;
            break;
          }

          case "DELAY": {
            // For delays in automated tests and runtime
            const delaySec = Math.min(step.durationSeconds, 10);
            await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
            stepOutput = { delayedSeconds: delaySec };
            break;
          }

          case "TRANSFORM": {
            const transformed: Record<string, unknown> = {};
            for (const [outKey, pathExpr] of Object.entries(step.mappings)) {
              transformed[outKey] = ConditionEngine.resolvePath(context, pathExpr);
            }
            stepOutput = transformed;
            context[step.outputKey || step.id] = transformed;
            break;
          }

          case "LOOP": {
            const items = ConditionEngine.resolvePath(context, step.itemsPath);
            const loopArray = Array.isArray(items) ? items : [];
            const maxIter = Math.min(loopArray.length, step.maxIterations || limits.maxLoopIterations);
            const loopOutputs: unknown[] = [];

            for (let i = 0; i < maxIter; i++) {
              loopOutputs.push({ index: i, item: loopArray[i] });
            }
            stepOutput = { iterations: maxIter, itemsProcessed: loopOutputs };
            context[step.id] = stepOutput;
            break;
          }

          case "KNOWLEDGE_RETRIEVAL": {
            const { KnowledgeService } = await import("../knowledge/KnowledgeService");
            const query = this.interpolate(step.queryTemplate, context);
            const results = await KnowledgeService.search(
              {
                query,
                limit: step.maxResults || 5,
                filter: step.collectionIds?.length ? { collectionIds: step.collectionIds } : undefined,
              },
              {
                organizationId: execution.organizationId,
                userId: execution.initiatedById || undefined,
                userPermissions: ["*"],
              }
            );

            stepOutput = {
              query,
              count: results.length,
              results: results.map((r) => ({
                documentTitle: r.documentTitle,
                collection: r.collectionName,
                score: r.score,
                snippet: r.content.slice(0, 300),
                content: r.content,
              })),
            };
            context[step.outputKey || step.id] = stepOutput;
            break;
          }

          default:
            break;
        }

        // Complete Step Execution
        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "COMPLETED",
            output: stepOutput as any,
            durationMs: stepDuration,
            completedAt: new Date(),
          },
        });

        currentStepIdx = nextStepIdx;

        // Update workflow execution checkpoint
        await prisma.automationExecution.update({
          where: { id: executionId },
          data: {
            currentStepIndex: currentStepIdx,
            context: context as any,
          },
        });
      } catch (stepErr: any) {
        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({
          where: { id: stepExecutionId },
          data: {
            status: "FAILED",
            errorMessage: stepErr?.message || String(stepErr),
            durationMs: stepDuration,
            completedAt: new Date(),
          },
        });

        // Check retry policy
        if (execution.retryCount < retryPolicy.maxRetries && step.retryOnFailure !== false) {
          const backoff = retryPolicy.exponential
            ? retryPolicy.backoffMs * Math.pow(2, execution.retryCount)
            : retryPolicy.backoffMs;

          await prisma.automationExecution.update({
            where: { id: executionId },
            data: {
              retryCount: { increment: 1 },
              status: "QUEUED",
              errorMessage: `Retrying after step failure: ${stepErr?.message}`,
            },
          });

          logger.warn(
            { executionId, stepId: step.id, retry: execution.retryCount + 1, backoff },
            "[WorkflowEngine] Scheduling retry after failure"
          );
          return { executionId, status: "RETRYING" };
        }

        return this.failExecution(executionId, execution.organizationId, stepErr?.message || String(stepErr));
      }
    }

    // 4. Mark Workflow Completed
    const totalDuration = Date.now() - startTime;
    const completed = await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        durationMs: totalDuration,
        output: context as any,
      },
    });

    await auditLogRepository.record({
      organizationId: execution.organizationId,
      actorUserId: execution.initiatedById || null,
      actorType: execution.initiatedById ? "USER" : "SYSTEM",
      action: "AUTOMATION_WORKFLOW_COMPLETED",
      resourceType: "automation_workflow",
      resourceId: workflow.id,
      metadata: {
        executionId,
        workflowName: workflow.name,
        durationMs: totalDuration,
        stepsExecuted: stepCount,
      },
    });

    return completed;
  }

  /**
   * Resume an execution after approval grant.
   */
  public async resumeExecution(executionId: string, organizationId: string): Promise<any> {
    const execution = await prisma.automationExecution.findFirst({
      where: { id: executionId, organizationId },
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }

    if (execution.status !== "WAITING_APPROVAL") {
      throw new Error(`Execution ${executionId} is not in WAITING_APPROVAL status (current: ${execution.status}).`);
    }

    // Advance to next step
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: "QUEUED",
        currentStepIndex: execution.currentStepIndex + 1,
      },
    });

    return this.execute(executionId);
  }

  /**
   * Cancel a running or waiting execution.
   */
  public async cancelExecution(executionId: string, organizationId: string, reason?: string): Promise<any> {
    const execution = await prisma.automationExecution.findFirst({
      where: { id: executionId, organizationId },
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }

    if (execution.status === "COMPLETED" || execution.status === "FAILED") {
      throw new Error(`Cannot cancel an execution with status ${execution.status}.`);
    }

    return prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        errorMessage: reason || "Cancelled by user",
      },
    });
  }

  private async failExecution(executionId: string, organizationId: string, error: string): Promise<any> {
    const failed = await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: error,
      },
    });

    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      action: "AUTOMATION_WORKFLOW_FAILED",
      resourceType: "automation_execution",
      resourceId: executionId,
      metadata: { error },
    });

    return failed;
  }

  /**
   * Interpolate variable strings like {{payload.client.name}} or {{invoice.amount}}
   */
  private interpolate(template: string, context: Record<string, unknown>): string {
    if (!template) return "";
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const val = ConditionEngine.resolvePath(context, path.trim());
      if (val === undefined || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  }

  private interpolateObject(obj: unknown, context: Record<string, unknown>): any {
    if (typeof obj === "string") {
      return this.interpolate(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateObject(item, context));
    }
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj as Record<string, any>)) {
        result[k] = this.interpolateObject(v, context);
      }
      return result;
    }
    return obj;
  }
}

export const workflowEngine = WorkflowEngine.getInstance();
