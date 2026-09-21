/**
 * Lead data access (Phase 5 — docs/CRM_ARCHITECTURE.md). Every query is
 * organization-scoped by the caller; this module never exposes a
 * lookup-by-id-alone method — see `findByIdInOrg`.
 */
import type { Lead, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface LeadFilters {
  search?: string;
  status?: string;
  source?: string;
  assignedTo?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function buildWhere(organizationId: string, filters: LeadFilters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumLeadStatusFilter["equals"];
  if (filters.source) where.source = filters.source;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { companyName: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

export const leadRepository = {
  async list(
    organizationId: string,
    filters: LeadFilters,
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: Lead[]; total: number }> {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.lead.count({ where }),
    ]);
    return { rows, total };
  },

  /** The only lookup-by-id this module exposes — always organization-scoped, so a cross-tenant id guess returns null, never another org's row (§4). */
  async findByIdInOrg(id: string, organizationId: string): Promise<Lead | null> {
    return prisma.lead.findFirst({ where: { id, organizationId, deletedAt: null } });
  },

  async findByEmailInOrg(organizationId: string, email: string): Promise<Lead[]> {
    return prisma.lead.findMany({
      where: { organizationId, email, deletedAt: null, status: { notIn: ["CONVERTED", "LOST"] } },
    });
  },

  async create(data: {
    organizationId: string;
    companyName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    source?: string;
    status?: string;
    notes?: string;
    assignedTo?: string;
  }): Promise<Lead> {
    return prisma.lead.create({
      data: {
        organizationId: data.organizationId,
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        source: data.source,
        status: (data.status as Lead["status"]) ?? "NEW",
        notes: data.notes,
        assignedTo: data.assignedTo,
      },
    });
  },

  async update(id: string, data: Prisma.LeadUpdateInput): Promise<Lead> {
    return prisma.lead.update({ where: { id }, data });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async countByStatus(organizationId: string): Promise<Record<string, number>> {
    const rows = await prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },

  async recentForOrg(organizationId: string, limit: number): Promise<Lead[]> {
    return prisma.lead.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};
