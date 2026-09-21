/**
 * AI Control Center Repository (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Organization-scoped data access for AI Providers, Models, Agents, Prompts, Workflows, Approvals, and Executions.
 */
import type {
  Prisma,
  AiAgentStatus,
  AiPromptStatus,
  AiWorkflowStatus,
  AiExecutionStatus,
  AiApprovalStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AiListFilters {
  search?: string;
  status?: string;
  capability?: string;
  providerId?: string;
  modelId?: string;
  agentId?: string;
}

export const aiRepository = {
  // ---------------------------------------------------------------------------
  // Providers
  // ---------------------------------------------------------------------------
  async listProviders(organizationId: string) {
    return prisma.aiProvider.findMany({
      where: { organizationId },
      include: { models: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  },

  async findProviderById(id: string, organizationId: string) {
    return prisma.aiProvider.findFirst({
      where: { id, organizationId },
      include: { models: true },
    });
  },

  async findDefaultProvider(organizationId: string) {
    return (
      (await prisma.aiProvider.findFirst({
        where: { organizationId, isDefault: true, status: "ACTIVE" },
        include: { models: true },
      })) ??
      (await prisma.aiProvider.findFirst({
        where: { organizationId, status: "ACTIVE" },
        include: { models: true },
      }))
    );
  },

  async createProvider(data: Prisma.AiProviderUncheckedCreateInput) {
    if (data.isDefault) {
      await prisma.aiProvider.updateMany({
        where: { organizationId: data.organizationId },
        data: { isDefault: false },
      });
    }
    return prisma.aiProvider.create({
      data,
      include: { models: true },
    });
  },

  async updateProvider(id: string, organizationId: string, data: Prisma.AiProviderUncheckedUpdateInput) {
    if (data.isDefault) {
      await prisma.aiProvider.updateMany({
        where: { organizationId },
        data: { isDefault: false },
      });
    }
    return prisma.aiProvider.update({
      where: { id },
      data,
      include: { models: true },
    });
  },

  async deleteProvider(id: string, _organizationId: string) {
    return prisma.aiProvider.delete({
      where: { id },
    });
  },

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------
  async listModels(providerId?: string) {
    return prisma.aiModel.findMany({
      where: providerId ? { providerId } : {},
      include: { provider: true },
      orderBy: [{ isDefault: "desc" }, { modelName: "asc" }],
    });
  },

  async findModelById(id: string) {
    return prisma.aiModel.findUnique({
      where: { id },
      include: { provider: true },
    });
  },

  async findDefaultModel(providerId?: string) {
    return (
      (await prisma.aiModel.findFirst({
        where: { ...(providerId ? { providerId } : {}), isDefault: true, status: "ACTIVE" },
        include: { provider: true },
      })) ??
      (await prisma.aiModel.findFirst({
        where: { ...(providerId ? { providerId } : {}), status: "ACTIVE" },
        include: { provider: true },
      }))
    );
  },

  async createModel(data: Prisma.AiModelUncheckedCreateInput) {
    if (data.isDefault) {
      await prisma.aiModel.updateMany({
        where: { providerId: data.providerId },
        data: { isDefault: false },
      });
    }
    return prisma.aiModel.create({
      data,
      include: { provider: true },
    });
  },

  async updateModel(id: string, data: Prisma.AiModelUncheckedUpdateInput) {
    if (data.isDefault && data.providerId) {
      await prisma.aiModel.updateMany({
        where: { providerId: data.providerId as string },
        data: { isDefault: false },
      });
    }
    return prisma.aiModel.update({
      where: { id },
      data,
      include: { provider: true },
    });
  },

  // ---------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------
  async listAgents(organizationId: string, filters: AiListFilters, page: number, limit: number) {
    const where: Prisma.AiAgentWhereInput = { organizationId };
    if (filters.status) where.status = filters.status as AiAgentStatus;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { purpose: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.aiAgent.findMany({
        where,
        include: { model: { include: { provider: true } }, createdBy: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiAgent.count({ where }),
    ]);
    return { rows, total };
  },

  async findAgentById(id: string, organizationId: string) {
    return prisma.aiAgent.findFirst({
      where: { id, organizationId },
      include: { model: { include: { provider: true } }, createdBy: true, versions: true },
    });
  },

  async createAgent(data: Prisma.AiAgentUncheckedCreateInput) {
    return prisma.aiAgent.create({
      data,
      include: { model: { include: { provider: true } } },
    });
  },

  async updateAgent(id: string, organizationId: string, data: Prisma.AiAgentUncheckedUpdateInput) {
    return prisma.aiAgent.update({
      where: { id },
      data,
      include: { model: { include: { provider: true } } },
    });
  },

  async createAgentVersion(data: Prisma.AiAgentVersionUncheckedCreateInput) {
    return prisma.aiAgentVersion.create({
      data,
    });
  },

  async listAgentVersions(agentId: string) {
    return prisma.aiAgentVersion.findMany({
      where: { agentId },
      orderBy: { version: "desc" },
    });
  },

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------
  async listPrompts(organizationId: string, filters: AiListFilters, page: number, limit: number) {
    const where: Prisma.AiPromptWhereInput = { organizationId };
    if (filters.status) where.status = filters.status as AiPromptStatus;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { category: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.aiPrompt.findMany({
        where,
        include: { createdBy: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiPrompt.count({ where }),
    ]);
    return { rows, total };
  },

  async findPromptById(id: string, organizationId: string) {
    return prisma.aiPrompt.findFirst({
      where: { id, organizationId },
      include: { createdBy: true, versions: true },
    });
  },

  async createPrompt(data: Prisma.AiPromptUncheckedCreateInput) {
    return prisma.aiPrompt.create({
      data,
      include: { createdBy: true },
    });
  },

  async updatePrompt(id: string, organizationId: string, data: Prisma.AiPromptUncheckedUpdateInput) {
    return prisma.aiPrompt.update({
      where: { id },
      data,
      include: { createdBy: true },
    });
  },

  async createPromptVersion(data: Prisma.AiPromptVersionUncheckedCreateInput) {
    return prisma.aiPromptVersion.create({
      data,
    });
  },

  async listPromptVersions(promptId: string) {
    return prisma.aiPromptVersion.findMany({
      where: { promptId },
      orderBy: { version: "desc" },
    });
  },

  // ---------------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------------
  async listWorkflows(organizationId: string, filters: AiListFilters, page: number, limit: number) {
    const where: Prisma.AiWorkflowWhereInput = { organizationId };
    if (filters.status) where.status = filters.status as AiWorkflowStatus;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.aiWorkflow.findMany({
        where,
        include: { agent: true, createdBy: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiWorkflow.count({ where }),
    ]);
    return { rows, total };
  },

  async findWorkflowById(id: string, organizationId: string) {
    return prisma.aiWorkflow.findFirst({
      where: { id, organizationId },
      include: { agent: true, createdBy: true },
    });
  },

  async createWorkflow(data: Prisma.AiWorkflowUncheckedCreateInput) {
    return prisma.aiWorkflow.create({
      data,
      include: { agent: true },
    });
  },

  async updateWorkflow(id: string, organizationId: string, data: Prisma.AiWorkflowUncheckedUpdateInput) {
    return prisma.aiWorkflow.update({
      where: { id },
      data,
      include: { agent: true },
    });
  },

  // ---------------------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------------------
  async listApprovals(organizationId: string, status?: string, page = 1, limit = 20) {
    const where: Prisma.AiApprovalWhereInput = { organizationId };
    if (status) where.status = status as AiApprovalStatus;
    const [rows, total] = await Promise.all([
      prisma.aiApproval.findMany({
        where,
        include: { approver: true },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiApproval.count({ where }),
    ]);
    return { rows, total };
  },

  async findApprovalById(id: string, organizationId: string) {
    return prisma.aiApproval.findFirst({
      where: { id, organizationId },
      include: { approver: true, execution: true },
    });
  },

  async createApproval(data: Prisma.AiApprovalUncheckedCreateInput) {
    return prisma.aiApproval.create({
      data,
    });
  },

  async updateApproval(id: string, organizationId: string, data: Prisma.AiApprovalUncheckedUpdateInput) {
    return prisma.aiApproval.update({
      where: { id },
      data,
      include: { approver: true },
    });
  },

  // ---------------------------------------------------------------------------
  // Executions
  // ---------------------------------------------------------------------------
  async listExecutions(organizationId: string, filters: AiListFilters, page: number, limit: number) {
    const where: Prisma.AiExecutionWhereInput = { organizationId };
    if (filters.status) where.status = filters.status as AiExecutionStatus;
    if (filters.capability) where.capability = filters.capability;
    if (filters.agentId) where.agentId = filters.agentId;
    if (filters.modelId) where.modelId = filters.modelId;

    const [rows, total] = await Promise.all([
      prisma.aiExecution.findMany({
        where,
        include: { agent: true, model: true, workflow: true },
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.aiExecution.count({ where }),
    ]);
    return { rows, total };
  },

  async findExecutionById(id: string, organizationId: string) {
    return prisma.aiExecution.findFirst({
      where: { id, organizationId },
      include: { agent: true, model: true, workflow: true, approvals: true },
    });
  },

  async createExecution(data: Prisma.AiExecutionUncheckedCreateInput) {
    return prisma.aiExecution.create({
      data,
    });
  },

  async updateExecution(id: string, data: Prisma.AiExecutionUncheckedUpdateInput) {
    return prisma.aiExecution.update({
      where: { id },
      data,
    });
  },

  // ---------------------------------------------------------------------------
  // Aggregated Statistics & Usage
  // ---------------------------------------------------------------------------
  async getDashboardStats(organizationId: string) {
    const [
      executions,
      pendingApprovalsCount,
      activeAgentsCount,
      activeWorkflowsCount,
      activeModelsCount,
      activeProvidersCount,
      recentExecutions,
      recentFailures,
    ] = await Promise.all([
      prisma.aiExecution.findMany({
        where: { organizationId },
        take: 1000,
        orderBy: { startedAt: "desc" },
      }),
      prisma.aiApproval.count({ where: { organizationId, status: "PENDING" } }),
      prisma.aiAgent.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.aiWorkflow.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.aiModel.count({ where: { status: "ACTIVE" } }),
      prisma.aiProvider.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.aiExecution.findMany({
        where: { organizationId },
        take: 8,
        orderBy: { startedAt: "desc" },
        include: { agent: true, model: true },
      }),
      prisma.aiExecution.findMany({
        where: { organizationId, status: "FAILED" },
        take: 5,
        orderBy: { startedAt: "desc" },
        include: { agent: true, model: true },
      }),
    ]);

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    let totalDuration = 0;
    let successfulCount = 0;
    let failedCount = 0;

    const capabilityMap: Record<string, number> = {};
    const modelMap: Record<string, number> = {};

    for (const ex of executions) {
      totalTokens += ex.totalTokens;
      inputTokens += ex.inputTokens;
      outputTokens += ex.outputTokens;
      totalCost += Number(ex.estimatedCost || 0);
      if (ex.durationMs) totalDuration += ex.durationMs;
      if (ex.status === "COMPLETED") successfulCount++;
      if (ex.status === "FAILED") failedCount++;

      const cap = ex.capability || "TEXT_GENERATION";
      capabilityMap[cap] = (capabilityMap[cap] || 0) + 1;

      const modelName = ex.modelId || "Default";
      modelMap[modelName] = (modelMap[modelName] || 0) + 1;
    }

    const totalCount = executions.length;
    const avgDuration = totalCount > 0 ? Math.round(totalDuration / totalCount) : 0;
    const successRate = totalCount > 0 ? Math.round((successfulCount / totalCount) * 100) : 100;

    return {
      totalExecutions: totalCount,
      successfulExecutions: successfulCount,
      failedExecutions: failedCount,
      successRate,
      pendingApprovals: pendingApprovalsCount,
      activeAgents: activeAgentsCount,
      activeWorkflows: activeWorkflowsCount,
      activeModels: activeModelsCount,
      activeProviders: activeProvidersCount,
      totalTokens,
      inputTokens,
      outputTokens,
      estimatedCost: Number(totalCost.toFixed(6)),
      averageDurationMs: avgDuration,
      breakdownByCapability: capabilityMap,
      breakdownByModel: modelMap,
      recentExecutions,
      recentFailures,
    };
  },
};
