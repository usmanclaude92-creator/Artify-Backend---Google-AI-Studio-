/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 13: Autonomous AI Workflows & Business Automation
 * Database-Backed Reliable Scheduler Engine
 */

import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { NotFoundError } from "../../core/errors";

export class SchedulerEngine {
  private static instance: SchedulerEngine;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private triggerWorkflowCallback: ((params: {
    workflowId: string;
    organizationId: string;
    triggerType: "SCHEDULE";
    input: Record<string, unknown>;
    correlationId: string;
  }) => Promise<any>) | null = null;

  public static getInstance(): SchedulerEngine {
    if (!SchedulerEngine.instance) {
      SchedulerEngine.instance = new SchedulerEngine();
    }
    return SchedulerEngine.instance;
  }

  /**
   * Set callback to invoke when a scheduled workflow is triggered.
   */
  public setWorkflowExecutor(
    executor: (params: {
      workflowId: string;
      organizationId: string;
      triggerType: "SCHEDULE";
      input: Record<string, unknown>;
      correlationId: string;
    }) => Promise<any>
  ) {
    this.triggerWorkflowCallback = executor;
  }

  /**
   * Start the scheduler tick interval.
   */
  public start(intervalMs = 30000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err }, "[SchedulerEngine] Error during scheduler tick");
      });
    }, intervalMs);
    // Don't prevent Node process from exiting during tests
    this.timer.unref();
    logger.info({ intervalMs }, "[SchedulerEngine] Background scheduler started");
  }

  /**
   * Stop the background scheduler.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[SchedulerEngine] Background scheduler stopped");
    }
  }

  /**
   * Calculate next run timestamp from schedule configuration.
   */
  public static calculateNextRun(schedule: {
    scheduleType: "ONE_TIME" | "RECURRING" | "CRON";
    intervalSeconds?: number | null;
    cronExpression?: string | null;
    lastRunAt?: Date | null;
  }): Date | null {
    const now = new Date();

    if (schedule.scheduleType === "ONE_TIME") {
      // One-time schedule runs once; if already run, next run is null
      return schedule.lastRunAt ? null : now;
    }

    if (schedule.scheduleType === "RECURRING") {
      const intervalSec = schedule.intervalSeconds || 3600; // default 1 hour
      const base = schedule.lastRunAt ? new Date(schedule.lastRunAt) : now;
      const next = new Date(base.getTime() + intervalSec * 1000);
      // If next is in the past, set to now + intervalSec
      if (next.getTime() <= now.getTime()) {
        return new Date(now.getTime() + intervalSec * 1000);
      }
      return next;
    }

    if (schedule.scheduleType === "CRON") {
      // Parse standard 5-part cron (minute hour day month weekday) or simplified patterns
      const cron = (schedule.cronExpression || "0 0 * * *").trim();
      const parts = cron.split(/\s+/);
      const next = new Date(now.getTime() + 60000); // at least 1 minute ahead

      if (parts.length >= 5) {
        const [min, hour] = parts;
        if (min !== "*" && !isNaN(Number(min))) {
          next.setMinutes(Number(min), 0, 0);
        }
        if (hour !== "*" && !isNaN(Number(hour))) {
          next.setHours(Number(hour));
        }
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1);
        }
      }
      return next;
    }

    return null;
  }

  /**
   * Evaluates due schedules and executes them safely.
   */
  public async tick(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const now = new Date();
      // Query active schedules where nextRunAt <= now or null (never run)
      const dueSchedules = await prisma.automationSchedule.findMany({
        where: {
          isActive: true,
          OR: [
            { nextRunAt: { lte: now } },
            { nextRunAt: null, lastRunAt: null },
          ],
        },
        take: 20,
      });

      let triggeredCount = 0;

      for (const schedule of dueSchedules) {
        try {
          const correlationId = crypto.randomUUID();
          const nextRun = SchedulerEngine.calculateNextRun({
            scheduleType: schedule.scheduleType as any,
            intervalSeconds: schedule.intervalSeconds,
            cronExpression: schedule.cronExpression,
            lastRunAt: now,
          });

          // Update schedule state atomically
          await prisma.automationSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt: nextRun,
              runCount: { increment: 1 },
              isActive: schedule.scheduleType === "ONE_TIME" ? false : schedule.isActive,
            },
          });

          // Trigger workflow execution if executor is set
          if (this.triggerWorkflowCallback) {
            await this.triggerWorkflowCallback({
              workflowId: schedule.workflowId,
              organizationId: schedule.organizationId,
              triggerType: "SCHEDULE",
              input: {
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                timestamp: now.toISOString(),
                ...(schedule.config as Record<string, unknown> || {}),
              },
              correlationId,
            });
            triggeredCount++;
          }
        } catch (execErr) {
          logger.error({ execErr, scheduleId: schedule.id }, "[SchedulerEngine] Error executing schedule");
        }
      }

      return triggeredCount;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Create a new schedule.
   */
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
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: params.workflowId, organizationId: params.organizationId },
    });
    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }

    const nextRunAt = SchedulerEngine.calculateNextRun({
      scheduleType: params.scheduleType,
      intervalSeconds: params.intervalSeconds,
      cronExpression: params.cronExpression,
      lastRunAt: null,
    });

    const schedule = await prisma.automationSchedule.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: params.organizationId,
        workflowId: params.workflowId,
        name: params.name,
        description: params.description || null,
        scheduleType: params.scheduleType,
        cronExpression: params.cronExpression || null,
        timezone: params.timezone || "UTC",
        intervalSeconds: params.intervalSeconds || null,
        isActive: true,
        nextRunAt,
        config: (params.config || {}) as any,
      },
      include: {
        workflow: {
          select: { id: true, name: true, status: true },
        },
      },
    });

    return schedule;
  }

  /**
   * Toggle schedule active state.
   */
  public async toggleSchedule(id: string, organizationId: string, isActive?: boolean) {
    const schedule = await prisma.automationSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!schedule) {
      throw new NotFoundError("Schedule not found.");
    }

    const newActive = isActive !== undefined ? isActive : !schedule.isActive;
    const nextRunAt = newActive
      ? SchedulerEngine.calculateNextRun({
          scheduleType: schedule.scheduleType as any,
          intervalSeconds: schedule.intervalSeconds,
          cronExpression: schedule.cronExpression,
          lastRunAt: schedule.lastRunAt,
        })
      : null;

    return prisma.automationSchedule.update({
      where: { id: schedule.id },
      data: { isActive: newActive, nextRunAt },
      include: {
        workflow: {
          select: { id: true, name: true, status: true },
        },
      },
    });
  }

  /**
   * Delete schedule.
   */
  public async deleteSchedule(id: string, organizationId: string) {
    const schedule = await prisma.automationSchedule.findFirst({
      where: { id, organizationId },
    });
    if (!schedule) {
      throw new NotFoundError("Schedule not found.");
    }

    await prisma.automationSchedule.delete({ where: { id } });
    return { deleted: true, id };
  }

  /**
   * List schedules with pagination.
   */
  public async listSchedules(params: {
    organizationId: string;
    workflowId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, any> = { organizationId: params.organizationId };
    if (params.workflowId) where.workflowId = params.workflowId;
    if (params.isActive !== undefined) where.isActive = params.isActive;

    const [rows, total] = await Promise.all([
      prisma.automationSchedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          workflow: {
            select: { id: true, name: true, status: true, category: true },
          },
        },
      }),
      prisma.automationSchedule.count({ where }),
    ]);

    return { rows, total, page, limit };
  }
}

export const schedulerEngine = SchedulerEngine.getInstance();
