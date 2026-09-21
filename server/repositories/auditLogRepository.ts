import type { AuditActorType, AuditResult, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AuditLogInput {
  organizationId?: string;
  actorUserId?: string;
  actorName?: string;
  actorType: AuditActorType;
  action: string;
  resourceType?: string;
  resourceId?: string;
  requestId?: string;
  result?: AuditResult;
  ipAddress?: string;
  userAgent?: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export const auditLogRepository = {
  /** Append-only by convention — no update/delete method exists on this repository (tests/security/audit.test.ts asserts this). */
  async record(entry: AuditLogInput): Promise<void> {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        actorName: entry.actorName,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId,
        result: entry.result ?? "SUCCESS",
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        beforeData: entry.beforeData as Prisma.InputJsonValue | undefined,
        afterData: entry.afterData as Prisma.InputJsonValue | undefined,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  },
};
