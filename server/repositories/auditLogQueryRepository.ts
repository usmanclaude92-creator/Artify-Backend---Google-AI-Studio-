/**
 * Read-only audit log queries (Phase 4 — Control Center Audit Log UI).
 * Deliberately a SEPARATE module from auditLogRepository.ts, which must
 * keep exposing exactly one method (`record`) — tests/security/
 * rbacAndAudit.test.ts asserts that append-only invariant by checking its
 * key set exactly. Read access is a different concern from write
 * integrity, so it lives here instead of widening that repository's
 * surface.
 */
import type { AuditActorType, AuditResult, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AuditLogFilters {
  organizationId?: string;
  actorUserId?: string;
  action?: string;
  resourceType?: string;
  result?: AuditResult;
  actorType?: AuditActorType;
  dateFrom?: Date;
  dateTo?: Date;
}

export const auditLogQueryRepository = {
  async list(filters: AuditLogFilters, page: number, limit: number) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: filters.organizationId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      resourceType: filters.resourceType,
      result: filters.result,
      actorType: filters.actorType,
    };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { rows, total };
  },
};
