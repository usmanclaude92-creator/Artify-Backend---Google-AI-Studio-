/**
 * Contract lifecycle + variations (Phase 10 — docs/COMMERCIAL_ARCHITECTURE.md).
 * Organization-scoped. Status is server-controlled only — DRAFT/SUSPENDED
 * -> ACTIVE, ACTIVE -> SUSPENDED, and any non-terminal status -> TERMINATED
 * each have their own dedicated, permission-gated endpoint; the generic
 * PATCH can never touch status. A contract's *current* value is always
 * computed on read as `contractValue + Σ(variations.amount)` — never
 * cached (see ContractVariation's schema doc comment) — so `getContract`
 * and `listContracts` both attach it as `currentValue`.
 */
import { contractRepository, type ContractFilters, type ContractWithVariations } from "../repositories/contractRepository";
import { clientRepository } from "../repositories/clientRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { calculateContractCurrentValue } from "./billingCalculations";
import { toMoney, DEFAULT_CURRENCY, type Money } from "../utils/money";
import { nextContractNumber } from "../utils/sequence";
import { prisma } from "../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateContractInput, CreateContractVariationInput, TerminateContractInput, UpdateContractInput } from "../schemas/contractSchemas";
import type { RequestMeta } from "./authService";
import type { Contract, Prisma } from "@prisma/client";

const ACTIVATABLE_FROM = ["DRAFT", "SUSPENDED"];
const SUSPENDABLE_FROM = ["ACTIVE"];
const TERMINABLE_FROM = ["DRAFT", "ACTIVE", "SUSPENDED"];

export interface ContractWithCurrentValue extends ContractWithVariations {
  currentValue: Money;
}

function withCurrentValue(contract: ContractWithVariations): ContractWithCurrentValue {
  return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
}

async function loadContractOrThrow(id: string, organizationId: string): Promise<ContractWithVariations> {
  const contract = await contractRepository.findByIdInOrg(id, organizationId);
  if (!contract) throw new NotFoundError("Contract not found.");
  return contract;
}

async function assertClientInOrg(clientId: string, organizationId: string): Promise<void> {
  const client = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client) throw new ValidationError("The specified client does not exist in this organization.");
}

export const contractService = {
  async listContracts(organizationId: string, filters: ContractFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const { rows, total } = await contractRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withCurrentValue), total };
  },

  async getContract(organizationId: string, id: string): Promise<ContractWithCurrentValue> {
    return withCurrentValue(await loadContractOrThrow(id, organizationId));
  },

  async createContract(caller: SanitizedUser, input: CreateContractInput, meta: RequestMeta = {}): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    await assertClientInOrg(input.clientId, organizationId);

    if (input.endDate && input.endDate.getTime() < input.startDate.getTime()) {
      throw new ValidationError("endDate cannot be before startDate.");
    }

    const contractNumber = await nextContractNumber();
    const contract: Contract = await contractRepository.create({
      contractNumber,
      organizationId,
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      contractValue: toMoney(input.contractValue),
      currency: input.currency ?? DEFAULT_CURRENCY,
      notes: input.notes,
      createdById: caller.id,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_CREATED",
      resourceType: "contract",
      resourceId: contract.id,
      afterData: { contractNumber, clientId: input.clientId, contractValue: contract.contractValue.toString(), currency: contract.currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, contract.id);
  },

  async updateContract(caller: SanitizedUser, id: string, input: UpdateContractInput, meta: RequestMeta = {}): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be edited.`);
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.endDate !== undefined) patch.endDate = input.endDate;
    if (input.notes !== undefined) patch.notes = input.notes;

    const where: Prisma.ContractWhereInput = { id, ...(input.expectedUpdatedAt !== undefined ? { updatedAt: input.expectedUpdatedAt } : {}) };
    const result = await prisma.contract.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This contract was changed by someone else since you loaded it. Reload and try again.");
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_UPDATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { title: existing.title },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, id);
  },

  async activateContract(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, ACTIVATABLE_FROM, "ACTIVE");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to ACTIVE.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_ACTIVATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, id);
  },

  async suspendContract(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, SUSPENDABLE_FROM, "SUSPENDED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to SUSPENDED.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_SUSPENDED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SUSPENDED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, id);
  },

  async terminateContract(caller: SanitizedUser, id: string, input: TerminateContractInput, meta: RequestMeta = {}): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, TERMINABLE_FROM, "TERMINATED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to TERMINATED.`);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_TERMINATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "TERMINATED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, id);
  },

  async createVariation(
    caller: SanitizedUser,
    contractId: string,
    input: CreateContractVariationInput,
    meta: RequestMeta = {}
  ): Promise<ContractWithCurrentValue> {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(contractId, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be varied.`);
    }

    const amount = toMoney(input.amount);
    if (amount.isZero()) throw new ValidationError("A contract variation's amount cannot be zero.");

    await prisma.$transaction(async (tx) => {
      // Row-locks the parent Contract so a concurrent variation create
      // against the same contract cannot compute the same next
      // variationNumber twice (§37) — the DB-level @@unique([contractId,
      // variationNumber]) is the backstop, this lock avoids relying on it
      // to surface as a retryable conflict.
      await contractRepository.lockForVariation(tx, contractId);
      const nextNumber = (await contractRepository.lastVariationNumber(tx, contractId)) + 1;
      await tx.contractVariation.create({
        data: { contractId, variationNumber: nextNumber, amount, effectiveDate: input.effectiveDate, reason: input.reason, createdById: caller.id },
      });
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_VARIATION_CREATED",
      resourceType: "contract",
      resourceId: contractId,
      afterData: { amount: amount.toString(), effectiveDate: input.effectiveDate, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.getContract(organizationId, contractId);
  },
};
