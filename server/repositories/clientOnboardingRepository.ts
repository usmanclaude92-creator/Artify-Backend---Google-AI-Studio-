/** Onboarding data access (Phase 6 — docs/CLIENT_ONBOARDING_ARCHITECTURE.md). One row per Client (@unique clientId). */
import type { ClientOnboarding, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ONBOARDING_CHECKLIST_KEYS, type OnboardingStepKey } from "../schemas/onboardingSchemas";

export interface ChecklistItem {
  key: OnboardingStepKey;
  label: string;
  completed: boolean;
  completedAt: string | null;
  completedById: string | null;
}

const STEP_LABELS: Record<OnboardingStepKey, string> = {
  CLIENT_VERIFIED: "Client verified",
  WORKSPACE_CREATED: "Workspace created",
  PRIMARY_CONTACT_CONFIRMED: "Primary contact confirmed",
  ADMINISTRATOR_INVITED: "Administrator invited",
  ADMINISTRATOR_ACCEPTED: "Administrator accepted",
  WORKSPACE_CONFIGURED: "Workspace configured",
  ONBOARDING_COMPLETED: "Onboarding completed",
};

export function freshChecklist(): ChecklistItem[] {
  return ONBOARDING_CHECKLIST_KEYS.map((key) => ({
    key,
    label: STEP_LABELS[key],
    completed: false,
    completedAt: null,
    completedById: null,
  }));
}

export function nextIncompleteStep(checklist: ChecklistItem[]): OnboardingStepKey | null {
  return checklist.find((item) => !item.completed)?.key ?? null;
}

export interface OnboardingFilters {
  status?: string;
  search?: string;
}

function buildWhere(organizationId: string, filters: OnboardingFilters): Prisma.ClientOnboardingWhereInput {
  const where: Prisma.ClientOnboardingWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumOnboardingStatusFilter["equals"];
  if (filters.search) {
    where.client = { name: { contains: filters.search, mode: "insensitive" } };
  }
  return where;
}

export const clientOnboardingRepository = {
  async list(organizationId: string, filters: OnboardingFilters, page: number, limit: number) {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.clientOnboarding.findMany({
        where,
        include: { client: { include: { workspaceOrganization: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.clientOnboarding.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.clientOnboarding.findFirst({
      where: { id, organizationId },
      include: { client: { include: { workspaceOrganization: true } } },
    });
  },

  async findByClientId(clientId: string): Promise<ClientOnboarding | null> {
    return prisma.clientOnboarding.findUnique({ where: { clientId } });
  },

  async create(data: { organizationId: string; clientId: string; createdById: string }): Promise<ClientOnboarding> {
    return prisma.clientOnboarding.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        createdById: data.createdById,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        checklist: freshChecklist() as unknown as Prisma.InputJsonValue,
        currentStep: freshChecklist()[0]!.key,
      },
    });
  },

  async update(id: string, data: Prisma.ClientOnboardingUpdateInput): Promise<ClientOnboarding> {
    return prisma.clientOnboarding.update({ where: { id }, data });
  },
};
