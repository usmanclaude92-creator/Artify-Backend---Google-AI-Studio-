/**
 * Client onboarding workflow (Phase 6 — docs/CLIENT_ONBOARDING_ARCHITECTURE.md).
 * Onboarding status is independent of workspace status (§7) — this service
 * never touches Organization.status, and workspaceService never touches
 * ClientOnboarding directly (only via markStepComplete below).
 */
import { clientOnboardingRepository, freshChecklist, nextIncompleteStep, type ChecklistItem } from "../repositories/clientOnboardingRepository";
import { clientRepository } from "../repositories/clientRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { OnboardingStepKey, UpdateOnboardingInput } from "../schemas/onboardingSchemas";
import type { RequestMeta } from "./authService";
import type { Client, ClientOnboarding } from "@prisma/client";

const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

async function loadClientInOrgOrThrow(clientId: string, organizationId: string): Promise<Client> {
  const client = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

async function loadOnboardingInOrgOrThrow(id: string, organizationId: string): Promise<ClientOnboarding> {
  const record = await clientOnboardingRepository.findByIdInOrg(id, organizationId);
  if (!record) throw new NotFoundError("Onboarding record not found.");
  return record;
}

export const onboardingService = {
  async listOnboarding(organizationId: string, filters: { status?: string; search?: string }, page: number, limit: number) {
    return clientOnboardingRepository.list(organizationId, filters, page, limit);
  },

  async getOnboarding(organizationId: string, id: string) {
    return loadOnboardingInOrgOrThrow(id, organizationId);
  },

  async getOnboardingForClient(organizationId: string, clientId: string) {
    await loadClientInOrgOrThrow(clientId, organizationId);
    return clientOnboardingRepository.findByClientId(clientId);
  },

  async startOnboarding(caller: SanitizedUser, clientId: string, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    await loadClientInOrgOrThrow(clientId, caller.organizationId);

    const existing = await clientOnboardingRepository.findByClientId(clientId);
    if (existing) {
      throw new ConflictError("Onboarding has already been started for this client.", { onboardingId: existing.id });
    }

    const record = await clientOnboardingRepository.create({
      organizationId: caller.organizationId,
      clientId,
      createdById: caller.id,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_STARTED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { clientId, status: record.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return record;
  },

  async updateOnboarding(caller: SanitizedUser, id: string, input: UpdateOnboardingInput, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError(`This onboarding is already ${existing.status.toLowerCase()} and can no longer be changed.`);
    }

    if (input.status === "CANCELLED") {
      const updated = await clientOnboardingRepository.update(id, { status: "CANCELLED", cancelledAt: new Date() });
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "CLIENT_ONBOARDING_CANCELLED",
        resourceType: "client_onboarding",
        resourceId: id,
        beforeData: { status: existing.status },
        afterData: { status: "CANCELLED" },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
      return updated;
    }

    if (input.completeStep) {
      return this.completeStep(caller, id, input.completeStep, meta);
    }

    return existing;
  },

  /**
   * Marks one checklist step complete (idempotent — re-completing an
   * already-complete step is a no-op, not an error, since both manual PATCH
   * calls and automatic calls from workspaceService/invitationService can
   * race to mark the same step). Advances currentStep; flips status to
   * READY once every step is done — completion itself is a separate,
   * explicit action (completeOnboarding), never inferred (§7).
   */
  async completeStep(caller: SanitizedUser, onboardingId: string, step: OnboardingStepKey, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const record = await loadOnboardingInOrgOrThrow(onboardingId, caller.organizationId);
    if (TERMINAL_STATUSES.has(record.status)) return record;

    const checklist = (record.checklist as unknown as ChecklistItem[]) ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item) throw new ValidationError(`Unknown onboarding step: ${step}`);
    if (item.completed) return record;

    item.completed = true;
    item.completedAt = new Date().toISOString();
    item.completedById = caller.id;

    const next = nextIncompleteStep(checklist);
    const updated = await clientOnboardingRepository.update(record.id, {
      checklist: checklist as unknown as never,
      currentStep: next,
      status: next === null ? "READY" : record.status,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step, status: updated.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  /** Marks a step complete by clientId — used by workspaceService/invitationService, which know the client, not the onboarding record id. Silently no-ops if onboarding was never started for this client (starting onboarding is optional before provisioning). */
  async completeStepForClient(clientId: string, step: OnboardingStepKey, actorUserId?: string): Promise<void> {
    const record = await clientOnboardingRepository.findByClientId(clientId);
    if (!record) return;
    const checklist = (record.checklist as unknown as ChecklistItem[]) ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item || item.completed) return;

    item.completed = true;
    item.completedAt = new Date().toISOString();
    item.completedById = actorUserId ?? null;
    const next = nextIncompleteStep(checklist);

    await clientOnboardingRepository.update(record.id, {
      checklist: checklist as unknown as never,
      currentStep: next,
      status: next === null ? "READY" : record.status,
    });

    await auditLogRepository.record({
      organizationId: record.organizationId,
      actorUserId,
      actorType: actorUserId ? "USER" : "SYSTEM",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step },
    });
  },

  async completeOnboarding(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ClientOnboarding> {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (existing.status === "COMPLETED") {
      throw new ConflictError("This onboarding has already been completed.");
    }
    if (existing.status !== "READY") {
      throw new ValidationError("Complete every checklist step before finishing onboarding.");
    }

    const updated = await clientOnboardingRepository.update(id, {
      status: "COMPLETED",
      completedAt: new Date(),
      completedBy: { connect: { id: caller.id } },
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: id,
      afterData: { status: "COMPLETED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },
};
