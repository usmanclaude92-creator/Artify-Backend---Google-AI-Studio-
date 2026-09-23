/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Automated Task Management Service
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";

export class TaskManager {
  private static instance: TaskManager;

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  /**
   * Create a new automated task.
   */
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
    const taskId = crypto.randomUUID();
    const dueDate = params.dueDate ? new Date(params.dueDate) : null;

    const task = await prisma.automationTask.create({
      data: {
        id: taskId,
        organizationId: params.organizationId,
        title: params.title,
        description: params.description || null,
        assignedUserId: params.assignedUserId || null,
        assignedRole: params.assignedRole || null,
        priority: params.priority || "MEDIUM",
        status: "PENDING",
        dueDate,
        sourceWorkflowId: params.sourceWorkflowId || null,
        sourceExecutionId: params.sourceExecutionId || null,
        sourceEntityType: params.sourceEntityType || null,
        sourceEntityId: params.sourceEntityId || null,
        isAiGenerated: params.isAiGenerated ?? true,
        metadata: (params.metadata || {}) as any,
      },
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return task;
  }

  /**
   * Update task status or assignment.
   */
  public async updateTask(params: {
    taskId: string;
    organizationId: string;
    userId?: string;
    status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    assignedUserId?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: string | Date;
  }) {
    const task = await prisma.automationTask.findFirst({
      where: { id: params.taskId, organizationId: params.organizationId },
    });

    if (!task) {
      throw new NotFoundError("Automation task not found.");
    }

    const updateData: Record<string, any> = {};
    if (params.status) {
      updateData.status = params.status;
      if (params.status === "COMPLETED") {
        updateData.completedAt = new Date();
      }
    }
    if (params.assignedUserId !== undefined) {
      updateData.assignedUserId = params.assignedUserId;
    }
    if (params.priority) {
      updateData.priority = params.priority;
    }
    if (params.dueDate !== undefined) {
      updateData.dueDate = params.dueDate ? new Date(params.dueDate) : null;
    }

    const updated = await prisma.automationTask.update({
      where: { id: task.id },
      data: updateData,
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_TASK_UPDATED",
        resourceType: "automation_task",
        resourceId: task.id,
        metadata: { updateData },
      });
    }

    return updated;
  }

  /**
   * List tasks with filters.
   */
  public async listTasks(params: {
    organizationId: string;
    status?: string;
    priority?: string;
    assignedUserId?: string;
    sourceWorkflowId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedUserId) where.assignedUserId = params.assignedUserId;
    if (params.sourceWorkflowId) where.sourceWorkflowId = params.sourceWorkflowId;

    const [rows, total] = await Promise.all([
      prisma.automationTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          assignedUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          workflow: {
            select: { id: true, name: true, category: true },
          },
        },
      }),
      prisma.automationTask.count({ where }),
    ]);

    return { rows, total, page, limit };
  }
}

export const taskManager = TaskManager.getInstance();
