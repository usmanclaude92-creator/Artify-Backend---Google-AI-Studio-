/**
 * Contract + ContractVariation data access (Phase 10 —
 * docs/COMMERCIAL_ARCHITECTURE.md). Same organization-scoped-lookup-only
 * convention as every tenant-owned repository since Phase 5. Contracts are
 * never soft-deleted (see schema.prisma's Contract doc comment) — lifecycle
 * is tracked purely via `status`.
 */
import type { Contract, ContractVariation, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

const withVariations = { include: { variations: { orderBy: { variationNumber: "asc" as const } } } };
export type ContractWithVariations = Prisma.ContractGetPayload<typeof withVariations>;

export interface ContractFilters {
  search?: string;
  status?: string;
  clientId?: string;
}

function buildWhere(organizationId: string, filters: ContractFilters): Prisma.ContractWhereInput {
  const where: Prisma.ContractWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumContractStatusFilter["equals"];
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.search) {
    where.OR = [
      { contractNumber: { contains: filters.search, mode: "insensitive" } },
      { title: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

export const contractRepository = {
  async list(organizationId: string, filters: ContractFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.contract.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withVariations }),
      prisma.contract.count({ where }),
    ]);
    return { rows, total };
  },

  /** The only lookup-by-id this module exposes — always organization-scoped (§25 IDOR requirement). */
  async findByIdInOrg(id: string, organizationId: string): Promise<ContractWithVariations | null> {
    return prisma.contract.findFirst({ where: { id, organizationId }, ...withVariations });
  },

  async listForClientInOrg(clientId: string, organizationId: string): Promise<Contract[]> {
    return prisma.contract.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },

  async create(data: {
    contractNumber: string;
    organizationId: string;
    clientId: string;
    title: string;
    description?: string;
    startDate: Date;
    endDate?: Date;
    contractValue: Prisma.Decimal;
    currency: string;
    notes?: string;
    createdById: string;
  }): Promise<Contract> {
    return prisma.contract.create({ data });
  },

  async update(id: string, data: Prisma.ContractUpdateInput): Promise<Contract> {
    return prisma.contract.update({ where: { id }, data });
  },

  /**
   * Race-safe conditional status transition — `WHERE id = ? AND status IN
   * (...)`, the same conditional-updateMany-plus-row-count pattern used
   * throughout this codebase since Phase 5 (lead conversion, workspace
   * provisioning, CMS optimistic concurrency, Phase 9 media). Returns the
   * affected row count so the caller can distinguish a genuine race from
   * success without a separate read-then-write.
   */
  async transitionStatus(id: string, fromStatuses: string[], toStatus: string): Promise<number> {
    const result = await prisma.contract.updateMany({
      where: { id, status: { in: fromStatuses as Prisma.EnumContractStatusFilter["in"] } },
      data: { status: toStatus as Contract["status"] },
    });
    return result.count;
  },

  async createVariation(data: {
    contractId: string;
    variationNumber: number;
    amount: Prisma.Decimal;
    effectiveDate: Date;
    reason: string;
    createdById: string;
  }): Promise<ContractVariation> {
    return prisma.contractVariation.create({ data });
  },

  async lastVariationNumber(tx: Prisma.TransactionClient, contractId: string): Promise<number> {
    const last = await tx.contractVariation.findFirst({ where: { contractId }, orderBy: { variationNumber: "desc" } });
    return last?.variationNumber ?? 0;
  },

  /** Row-locks the parent Contract so concurrent variation creates against the same contract serialize instead of racing on `variationNumber` (§37). */
  async lockForVariation(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
  },
};
