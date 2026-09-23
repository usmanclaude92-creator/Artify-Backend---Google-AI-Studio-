/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Human-in-the-Loop Approval Engine
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { NotFoundError, ValidationError } from "../../core/errors";
import { logger } from "../../core/logger";

export class ApprovalEngine {
  private static instance: ApprovalEngine;

  public static getInstance(): ApprovalEngine {
    if (!ApprovalEngine.instance) {
      ApprovalEngine.instance = new ApprovalEngine();
    }
    return ApprovalEngine.instance;
  }

  /**
   * Request human approval for an automation workflow step.
   */
  public async requestApproval(params: {
    organizationId: string;
    executionId: string;
    stepExecutionId?: string;
    workflowId: string;
    stepId: string;
    action: string;
    description?: string;
    entityType?: string;
    entityId?: string;
    payload: Record<string, unknown>;
    requiredRole?: string;
    requesterId?: string;
    timeoutMinutes?: number;
  }): Promise<{ approvalId: string; status: "PENDING" }> {
    const approvalId = crypto.randomUUID();
    const expiresAt = params.timeoutMinutes
      ? new Date(Date.now() + params.timeoutMinutes * 60 * 1000)
      : null;

    const approval = await prisma.automationApproval.create({
      data: {
        id: approvalId,
        organizationId: params.organizationId,
        executionId: params.executionId,
        stepExecutionId: params.stepExecutionId || null,
        workflowId: params.workflowId,
        stepId: params.stepId,
        action: params.action,
        description: params.description || null,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        payload: params.payload as any,
        requiredRole: params.requiredRole || null,
        status: "PENDING",
        requesterId: params.requesterId || null,
        expiresAt,
      },
    });

    // Also link with Phase 12 ai_approvals table for centralized control center visibility
    try {
      await prisma.aiApproval.create({
        data: {
          id: approvalId,
          organizationId: params.organizationId,
          workflowId: params.workflowId,
          executionId: params.executionId,
          requesterId: params.requesterId || null,
          action: params.action,
          entityType: params.entityType || null,
          entityId: params.entityId || null,
          payload: params.payload as any,
          status: "PENDING",
          expiresAt,
        },
      });
    } catch (err) {
      logger.warn({ err }, "[ApprovalEngine] Phase 12 ai_approvals mirror record skipped");
    }

    // Record audit event
    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.requesterId || null,
      actorType: params.requesterId ? "USER" : "SYSTEM",
      action: "AUTOMATION_APPROVAL_REQUESTED",
      resourceType: "automation_approval",
      resourceId: approval.id,
      metadata: {
        workflowId: params.workflowId,
        executionId: params.executionId,
        stepId: params.stepId,
        action: params.action,
      },
    });

    return { approvalId: approval.id, status: "PENDING" };
  }

  /**
   * Decide on a pending approval (APPROVE / REJECT).
   */
  public async decideApproval(params: {
    approvalId: string;
    organizationId: string;
    userId: string;
    userRole: string;
    decision: "APPROVED" | "REJECTED";
    reason?: string;
  }): Promise<{
    approval: any;
    executionResumed: boolean;
  }> {
    const approval = await prisma.automationApproval.findFirst({
      where: { id: params.approvalId, organizationId: params.organizationId },
    });

    if (!approval) {
      throw new NotFoundError("Automation approval request not found.");
    }

    if (approval.status !== "PENDING") {
      throw new ValidationError(`Approval request is already resolved with status ${approval.status}.`);
    }

    // Verify role if a specific role is required
    if (approval.requiredRole && params.userRole !== approval.requiredRole && params.userRole !== "SUPER_ADMIN" && params.userRole !== "ADMIN") {
      throw new ValidationError(`Forbidden: Only users with role ${approval.requiredRole} can decide this approval.`);
    }

    const updated = await prisma.automationApproval.update({
      where: { id: approval.id },
      data: {
        status: params.decision,
        approverId: params.userId,
        decisionReason: params.reason || null,
        decidedAt: new Date(),
      },
    });

    // Mirror to ai_approvals if present
    try {
      await prisma.aiApproval.update({
        where: { id: approval.id },
        data: {
          status: params.decision as any,
          approverId: params.userId,
          decisionReason: params.reason || null,
          decidedAt: new Date(),
        },
      });
    } catch {
      // ignore
    }

    // Record audit event
    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      actorType: "USER",
      action: params.decision === "APPROVED" ? "AUTOMATION_APPROVAL_GRANTED" : "AUTOMATION_APPROVAL_REJECTED",
      resourceType: "automation_approval",
      resourceId: approval.id,
      metadata: {
        workflowId: approval.workflowId,
        executionId: approval.executionId,
        decision: params.decision,
        reason: params.reason,
      },
    });

    return {
      approval: updated,
      executionResumed: params.decision === "APPROVED",
    };
  }

  /**
   * List approvals with filters.
   */
  public async listApprovals(params: {
    organizationId: string;
    status?: string;
    workflowId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.workflowId) where.workflowId = params.workflowId;

    const [rows, total] = await Promise.all([
      prisma.automationApproval.findMany({
        where,
        skip,
        take: limit,
        orderBy: { requestedAt: "desc" },
        include: {
          approver: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          workflow: {
            select: { id: true, name: true, category: true },
          },
        },
      }),
      prisma.automationApproval.count({ where }),
    ]);

    return { rows, total, page, limit };
  }
}

export const approvalEngine = ApprovalEngine.getInstance();
