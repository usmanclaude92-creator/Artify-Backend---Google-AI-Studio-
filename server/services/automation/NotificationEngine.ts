/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Reusable Notification Dispatch Engine
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";

export class NotificationEngine {
  private static instance: NotificationEngine;

  public static getInstance(): NotificationEngine {
    if (!NotificationEngine.instance) {
      NotificationEngine.instance = new NotificationEngine();
    }
    return NotificationEngine.instance;
  }

  /**
   * Dispatch a notification to a specific user or role.
   */
  public async dispatchNotification(params: {
    organizationId: string;
    userId?: string;
    recipientRole?: string;
    channel?: "IN_APP" | "EMAIL" | "SMS" | "WEBHOOK";
    title: string;
    message: string;
    level?: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
    sourceWorkflowId?: string;
    sourceExecutionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; delivered: boolean }> {
    const channel = params.channel || "IN_APP";
    const level = params.level || "INFO";
    const notifId = crypto.randomUUID();

    // Check user preference if userId provided and channel is external
    if (params.userId && channel !== "IN_APP") {
      try {
        const pref = await prisma.notificationPreference.findFirst({
          where: { userId: params.userId, organizationId: params.organizationId },
        });
        if (pref) {
          if (channel === "EMAIL" && pref.emailEnabled === false) {
            logger.info({ userId: params.userId }, "[NotificationEngine] Email suppressed by user preference");
            return { id: notifId, delivered: false };
          }
          if (channel === "SMS" && pref.smsEnabled === false) {
            logger.info({ userId: params.userId }, "[NotificationEngine] SMS suppressed by user preference");
            return { id: notifId, delivered: false };
          }
        }
      } catch {
        // Continue if preferences table check encounters any issue
      }
    }

    // Persist to automation_notifications table
    const record = await prisma.automationNotification.create({
      data: {
        id: notifId,
        organizationId: params.organizationId,
        userId: params.userId || null,
        recipientRole: params.recipientRole || null,
        channel,
        title: params.title,
        message: params.message,
        level,
        status: "DELIVERED",
        sourceWorkflowId: params.sourceWorkflowId || null,
        sourceExecutionId: params.sourceExecutionId || null,
        metadata: (params.metadata || {}) as any,
      },
    });

    // If targeted to a user and channel is IN_APP, write to core notifications table as well
    if (params.userId && channel === "IN_APP") {
      try {
        await prisma.notification.create({
          data: {
            id: crypto.randomUUID(),
            organizationId: params.organizationId,
            userId: params.userId,
            title: params.title,
            message: params.message,
            type: level === "ERROR" ? "SYSTEM_ALERT" : "WORKFLOW_UPDATE",
            status: "UNREAD",
            payload: {
              sourceWorkflowId: params.sourceWorkflowId,
              sourceExecutionId: params.sourceExecutionId,
            } as any,
          },
        });
      } catch (err) {
        logger.warn({ err }, "[NotificationEngine] Core notification sync skipped");
      }
    }

    return { id: record.id, delivered: true };
  }

  /**
   * List notifications for an organization or user.
   */
  public async listNotifications(params: {
    organizationId: string;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.userId) where.userId = params.userId;

    const [rows, total] = await Promise.all([
      prisma.automationNotification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.automationNotification.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  /**
   * Mark notification as read.
   */
  public async markAsRead(id: string, organizationId: string): Promise<boolean> {
    await prisma.automationNotification.updateMany({
      where: { id, organizationId },
      data: { status: "READ", readAt: new Date() },
    });
    return true;
  }
}

export const notificationEngine = NotificationEngine.getInstance();
