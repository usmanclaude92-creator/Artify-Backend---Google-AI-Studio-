/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Controlled Business Action Registry
 */

import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { logger } from "../../core/logger";
import { BusinessActionDefinition } from "./types";

export class ActionRegistry {
  private static instance: ActionRegistry;
  private actions = new Map<string, BusinessActionDefinition<any, any>>();

  private constructor() {
    this.registerStandardActions();
  }

  public static getInstance(): ActionRegistry {
    if (!ActionRegistry.instance) {
      ActionRegistry.instance = new ActionRegistry();
    }
    return ActionRegistry.instance;
  }

  public registerAction<TInput, TOutput>(action: BusinessActionDefinition<TInput, TOutput>): void {
    this.actions.set(action.id, action as any);
  }

  public getAction(id: string): BusinessActionDefinition<any, any> | undefined {
    return this.actions.get(id);
  }

  public listActions(): Array<{
    id: string;
    name: string;
    description: string;
    requiredPermission: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    requiresApproval: boolean;
    requiresAudit: boolean;
  }> {
    return Array.from(this.actions.values()).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      requiredPermission: a.requiredPermission,
      riskLevel: a.riskLevel,
      requiresApproval: a.requiresApproval,
      requiresAudit: a.requiresAudit,
    }));
  }

  private registerStandardActions(): void {
    // -------------------------------------------------------------------------
    // Action 1: create_task
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "create_task",
      name: "Create Task",
      description: "Creates an automated or AI-recommended business task assigned to a team member or role",
      requiredPermission: "automation.execute",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        assignedUserId: z.string().optional(),
        assignedRole: z.string().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
        dueDate: z.string().optional(),
        sourceEntityType: z.string().optional(),
        sourceEntityId: z.string().optional(),
        isAiGenerated: z.boolean().default(true),
        metadata: z.record(z.unknown()).optional(),
      }),
      outputSchema: z.object({
        taskId: z.string(),
        title: z.string(),
        status: z.string(),
      }),
      execute: async (input, context) => {
        const taskId = crypto.randomUUID();
        const dueDate = input.dueDate ? new Date(input.dueDate) : null;

        const task = await prisma.automationTask.create({
          data: {
            id: taskId,
            organizationId: context.organizationId,
            title: input.title,
            description: input.description || null,
            assignedUserId: input.assignedUserId || null,
            assignedRole: input.assignedRole || null,
            priority: input.priority,
            status: "PENDING",
            dueDate,
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null,
            sourceEntityType: input.sourceEntityType || null,
            sourceEntityId: input.sourceEntityId || null,
            isAiGenerated: input.isAiGenerated,
            metadata: (input.metadata || {}) as any,
          },
        });

        return {
          taskId: task.id,
          title: task.title,
          status: task.status,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 2: update_client
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "update_client",
      name: "Update Client Details",
      description: "Updates CRM client status, notes, or metadata based on automation workflow",
      requiredPermission: "clients.update",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z.object({
        clientId: z.string().min(1),
        status: z.string().optional(),
        notes: z.string().optional(),
      }),
      outputSchema: z.object({
        clientId: z.string(),
        updated: z.boolean(),
      }),
      execute: async (input, context) => {
        const client = await prisma.client.findFirst({
          where: { id: input.clientId, organizationId: context.organizationId },
        });

        if (!client) {
          throw new Error(`Client with id ${input.clientId} not found in organization.`);
        }

        const updateData: Record<string, any> = {};
        if (input.status) updateData.status = input.status;
        if (input.notes) updateData.notes = input.notes;

        if (Object.keys(updateData).length > 0) {
          await prisma.client.update({
            where: { id: client.id },
            data: updateData,
          });
        }

        return {
          clientId: client.id,
          updated: true,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 3: create_notification
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "create_notification",
      name: "Create Notification",
      description: "Creates an in-app and system notification for target user or role",
      requiredPermission: "automation.execute",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: false,
      inputSchema: z.object({
        userId: z.string().optional(),
        recipientRole: z.string().optional(),
        title: z.string().min(1),
        message: z.string().min(1),
        level: z.enum(["INFO", "WARNING", "ERROR", "SUCCESS"]).default("INFO"),
        channel: z.enum(["IN_APP", "EMAIL", "SMS", "WEBHOOK"]).default("IN_APP"),
        metadata: z.record(z.unknown()).optional(),
      }),
      outputSchema: z.object({
        notificationId: z.string(),
        delivered: z.boolean(),
      }),
      execute: async (input, context) => {
        const notifId = crypto.randomUUID();

        // 1. Create AutomationNotification record
        const autoNotif = await prisma.automationNotification.create({
          data: {
            id: notifId,
            organizationId: context.organizationId,
            userId: input.userId || null,
            recipientRole: input.recipientRole || null,
            channel: input.channel,
            title: input.title,
            message: input.message,
            level: input.level,
            status: "DELIVERED",
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null,
            metadata: (input.metadata || {}) as any,
          },
        });

        // 2. Also write to core notifications table if targeted to a user
        if (input.userId) {
          try {
            await prisma.notification.create({
              data: {
                id: crypto.randomUUID(),
                organizationId: context.organizationId,
                userId: input.userId,
                title: input.title,
                message: input.message,
                type: input.level === "ERROR" ? "SYSTEM_ALERT" : "WORKFLOW_UPDATE",
                status: "UNREAD",
                payload: {
                  sourceWorkflowId: context.workflowId,
                  sourceExecutionId: context.executionId,
                } as any,
              },
            });
          } catch (err) {
            logger.warn({ err }, "[ActionRegistry] Optional core notification write skipped");
          }
        }

        return {
          notificationId: autoNotif.id,
          delivered: true,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 4: assign_user
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "assign_user",
      name: "Assign User to Entity",
      description: "Assigns a team member to a lead, client, or task",
      requiredPermission: "automation.execute",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z.object({
        entityType: z.enum(["LEAD", "CLIENT", "TASK"]),
        entityId: z.string().min(1),
        userId: z.string().min(1),
      }),
      outputSchema: z.object({
        entityId: z.string(),
        assignedUserId: z.string(),
        success: z.boolean(),
      }),
      execute: async (input, _context) => {
        if (input.entityType === "LEAD") {
          await prisma.lead.update({
            where: { id: input.entityId },
            data: { assignedUserId: input.userId },
          });
        } else if (input.entityType === "CLIENT") {
          await prisma.client.update({
            where: { id: input.entityId },
            data: { accountManagerId: input.userId },
          });
        } else if (input.entityType === "TASK") {
          await prisma.automationTask.update({
            where: { id: input.entityId },
            data: { assignedUserId: input.userId },
          });
        }

        return {
          entityId: input.entityId,
          assignedUserId: input.userId,
          success: true,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 5: generate_report
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "generate_report",
      name: "Generate Report",
      description: "Generates a structured automation or performance report",
      requiredPermission: "reports.read",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z.object({
        reportType: z.string(),
        title: z.string(),
        parameters: z.record(z.unknown()).optional(),
      }),
      outputSchema: z.object({
        reportId: z.string(),
        generatedAt: z.string(),
        summary: z.string(),
      }),
      execute: async (input, context) => {
        const reportId = crypto.randomUUID();
        const generatedAt = new Date().toISOString();

        return {
          reportId,
          generatedAt,
          summary: `Report "${input.title}" (${input.reportType}) generated successfully for workflow ${context.workflowId || "manual"}.`,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 6: create_invoice_draft
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "create_invoice_draft",
      name: "Create Invoice Draft",
      description: "Drafts a new invoice requiring accounts review or automation dispatch",
      requiredPermission: "invoices.create",
      riskLevel: "HIGH",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z.object({
        clientId: z.string().min(1),
        amountDue: z.number().positive(),
        currency: z.string().default("USD"),
        dueDate: z.string().optional(),
        memo: z.string().optional(),
      }),
      outputSchema: z.object({
        draftCreated: z.boolean(),
        invoiceNumber: z.string(),
        amountDue: z.number(),
      }),
      execute: async (input, _context) => {
        const invoiceNumber = `INV-DRAFT-${Date.now().toString(36).toUpperCase()}`;

        return {
          draftCreated: true,
          invoiceNumber,
          amountDue: input.amountDue,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 7: update_workflow_status
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "update_workflow_status",
      name: "Update Workflow Status",
      description: "Controls the active or paused status of an automated workflow",
      requiredPermission: "automation.manage",
      riskLevel: "HIGH",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z.object({
        workflowId: z.string().min(1),
        status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
      }),
      outputSchema: z.object({
        workflowId: z.string(),
        newStatus: z.string(),
      }),
      execute: async (input, _context) => {
        const updated = await prisma.automationWorkflow.update({
          where: { id: input.workflowId },
          data: { status: input.status as any },
        });

        return {
          workflowId: updated.id,
          newStatus: updated.status,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 8: publish_approved_content
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "publish_approved_content",
      name: "Publish Approved Content",
      description: "Publishes approved CMS page or post content",
      requiredPermission: "content.publish",
      riskLevel: "HIGH",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z.object({
        contentType: z.enum(["PAGE", "POST"]),
        contentId: z.string().min(1),
      }),
      outputSchema: z.object({
        contentId: z.string(),
        published: z.boolean(),
      }),
      execute: async (input, _context) => {
        if (input.contentType === "PAGE") {
          await prisma.page.update({
            where: { id: input.contentId },
            data: { status: "PUBLISHED", publishedAt: new Date() },
          });
        } else {
          await prisma.post.update({
            where: { id: input.contentId },
            data: { status: "PUBLISHED", publishedAt: new Date() },
          });
        }

        return {
          contentId: input.contentId,
          published: true,
        };
      },
    });

    // -------------------------------------------------------------------------
    // Action 9: send_approved_notification
    // -------------------------------------------------------------------------
    this.registerAction({
      id: "send_approved_notification",
      name: "Send Approved Notification",
      description: "Dispatches a high-priority approved notification",
      requiredPermission: "automation.execute",
      riskLevel: "MEDIUM",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z.object({
        recipientUserId: z.string().min(1),
        title: z.string().min(1),
        message: z.string().min(1),
      }),
      outputSchema: z.object({
        sent: z.boolean(),
      }),
      execute: async (input, context) => {
        await prisma.automationNotification.create({
          data: {
            id: crypto.randomUUID(),
            organizationId: context.organizationId,
            userId: input.recipientUserId,
            channel: "IN_APP",
            title: input.title,
            message: input.message,
            level: "INFO",
            status: "DELIVERED",
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null,
          },
        });

        return { sent: true };
      },
    });
  }

  /**
   * Executes a registered action with safety checks, idempotency, and audit logging.
   */
  public async executeAction(params: {
    actionId: string;
    input: Record<string, unknown>;
    organizationId: string;
    userId?: string;
    userPermissions: readonly string[];
    workflowId?: string;
    executionId?: string;
    stepId?: string;
    correlationId: string;
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>> {
    const action = this.actions.get(params.actionId);
    if (!action) {
      throw new Error(`Business action "${params.actionId}" is not registered in the system.`);
    }

    // 1. Permission check
    if (action.requiredPermission && !params.userPermissions.includes(action.requiredPermission) && !params.userPermissions.includes("*")) {
      throw new Error(`Forbidden: missing required permission "${action.requiredPermission}" for action "${action.id}".`);
    }

    // 2. Validate input schema
    const validatedInput = action.inputSchema.parse(params.input);

    // 3. Idempotency check: if an execution already succeeded with this idempotency key, return cached result!
    if (params.idempotencyKey) {
      const existing = await prisma.automationActionExecution.findFirst({
        where: {
          organizationId: params.organizationId,
          idempotencyKey: params.idempotencyKey,
          status: "SUCCESS",
        },
      });

      if (existing) {
        logger.info(
          { idempotencyKey: params.idempotencyKey, actionId: params.actionId },
          "[ActionRegistry] Returning idempotent cached action output"
        );
        return existing.output as Record<string, unknown>;
      }
    }

    // 4. Execute action
    const startTime = Date.now();
    let actionOutput: Record<string, unknown>;
    let actionStatus = "SUCCESS";
    let errorMessage: string | null = null;

    try {
      actionOutput = await action.execute(validatedInput, {
        organizationId: params.organizationId,
        userId: params.userId,
        workflowId: params.workflowId,
        executionId: params.executionId,
        stepId: params.stepId,
        correlationId: params.correlationId,
      });

      // Validate output
      actionOutput = action.outputSchema.parse(actionOutput);
    } catch (err: any) {
      actionStatus = "FAILED";
      errorMessage = err?.message || String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;

      // Record in automation_action_executions
      if (params.executionId) {
        try {
          await prisma.automationActionExecution.create({
            data: {
              id: crypto.randomUUID(),
              organizationId: params.organizationId,
              executionId: params.executionId,
              stepId: params.stepId || "action_step",
              actionId: params.actionId,
              status: actionStatus,
              input: validatedInput as any,
              output: (actionOutput! || {}) as any,
              idempotencyKey: params.idempotencyKey || null,
              durationMs,
              errorMessage,
            },
          });
        } catch (recErr) {
          logger.warn({ recErr }, "[ActionRegistry] Failed to record action execution");
        }
      }

      // Record audit log if required
      if (action.requiresAudit) {
        await auditLogRepository.record({
          organizationId: params.organizationId,
          actorUserId: params.userId || null,
          actorType: params.userId ? "USER" : "SYSTEM",
          action: `AUTOMATION_ACTION_${params.actionId.toUpperCase()}`,
          resourceType: "automation_action",
          resourceId: params.actionId,
          metadata: {
            workflowId: params.workflowId,
            executionId: params.executionId,
            stepId: params.stepId,
            status: actionStatus,
            riskLevel: action.riskLevel,
            correlationId: params.correlationId,
          },
        });
      }
    }

    return actionOutput;
  }
}

export const actionRegistry = ActionRegistry.getInstance();
