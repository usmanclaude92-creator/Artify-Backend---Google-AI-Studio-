/**
 * AI Service (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Core business logic and governance orchestration for the AI Control Center.
 */
import { aiRepository, type AiListFilters } from "../../repositories/aiRepository";
import { aiOrchestrator } from "./AiOrchestrator";
import { AI_CAPABILITIES, getCapability } from "../../ai/capabilities";
import { AI_TOOL_REGISTRY, aiToolExecutor } from "../../ai/tools";
import { AdapterFactory } from "../../ai/adapters/adapterFactory";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { ValidationError, NotFoundError } from "../../core/errors";
import type { Prisma } from "@prisma/client";

export class AiService {
  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------
  public getCapabilities() {
    return AI_CAPABILITIES;
  }

  public getCapabilityDetails(id: string) {
    const cap = getCapability(id);
    if (!cap) throw new NotFoundError(`Capability ${id} is not supported.`);
    return cap;
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Metrics
  // ---------------------------------------------------------------------------
  public async getDashboard(organizationId: string) {
    return aiRepository.getDashboardStats(organizationId);
  }

  // ---------------------------------------------------------------------------
  // Providers
  // ---------------------------------------------------------------------------
  public async listProviders(organizationId: string) {
    return aiRepository.listProviders(organizationId);
  }

  public async getProvider(id: string, organizationId: string) {
    const provider = await aiRepository.findProviderById(id, organizationId);
    if (!provider) throw new NotFoundError("AI Provider not found.");
    return provider;
  }

  public async createProvider(organizationId: string, data: Prisma.AiProviderUncheckedCreateInput) {
    if (!data.name || !data.providerType) {
      throw new ValidationError("Provider name and providerType are required.");
    }
    return aiRepository.createProvider({ ...data, organizationId });
  }

  public async updateProvider(id: string, organizationId: string, data: Prisma.AiProviderUncheckedUpdateInput) {
    await this.getProvider(id, organizationId);
    return aiRepository.updateProvider(id, organizationId, data);
  }

  public async deleteProvider(id: string, organizationId: string) {
    await this.getProvider(id, organizationId);
    return aiRepository.deleteProvider(id, organizationId);
  }

  public async testProvider(id: string, organizationId: string) {
    const provider = await this.getProvider(id, organizationId);
    const adapter = AdapterFactory.getAdapter(provider.providerType);
    const testPrompt = "Ping test: Verify operational latency and platform response.";

    const result = await adapter.generateText({
      modelName: "gemini-2.5-flash",
      prompt: testPrompt,
      maxTokens: 50,
    });

    return {
      success: true,
      providerId: provider.id,
      providerType: provider.providerType,
      durationMs: result.durationMs,
      responseSample: result.text.slice(0, 100),
    };
  }

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------
  public async listModels(providerId?: string) {
    return aiRepository.listModels(providerId);
  }

  public async getModel(id: string) {
    const model = await aiRepository.findModelById(id);
    if (!model) throw new NotFoundError("AI Model not found.");
    return model;
  }

  public async createModel(data: Prisma.AiModelUncheckedCreateInput) {
    if (!data.modelName || !data.providerId) {
      throw new ValidationError("modelName and providerId are required.");
    }
    return aiRepository.createModel(data);
  }

  public async updateModel(id: string, data: Prisma.AiModelUncheckedUpdateInput) {
    await this.getModel(id);
    return aiRepository.updateModel(id, data);
  }

  // ---------------------------------------------------------------------------
  // Agents & Versioning
  // ---------------------------------------------------------------------------
  public async listAgents(organizationId: string, filters: AiListFilters, page = 1, limit = 20) {
    return aiRepository.listAgents(organizationId, filters, page, limit);
  }

  public async getAgent(id: string, organizationId: string) {
    const agent = await aiRepository.findAgentById(id, organizationId);
    if (!agent) throw new NotFoundError("AI Agent not found.");
    return agent;
  }

  public async createAgent(organizationId: string, userId: string, data: Prisma.AiAgentUncheckedCreateInput) {
    if (!data.name || !data.systemInstructions) {
      throw new ValidationError("Agent name and systemInstructions are required.");
    }

    const agent = await aiRepository.createAgent({
      ...data,
      organizationId,
      createdById: userId,
      updatedById: userId,
      version: 1,
    });

    // Record initial version
    await aiRepository.createAgentVersion({
      agentId: agent.id,
      version: 1,
      name: agent.name,
      modelId: agent.modelId,
      systemInstructions: agent.systemInstructions,
      configuration: agent.configuration as Prisma.InputJsonValue,
      allowedTools: (agent.allowedTools ?? []) as Prisma.InputJsonValue,
      allowedCapabilities: (agent.allowedCapabilities ?? []) as Prisma.InputJsonValue,
      createdById: userId,
    });

    return agent;
  }

  public async updateAgent(
    id: string,
    organizationId: string,
    userId: string,
    data: Prisma.AiAgentUncheckedUpdateInput,
    _changeNote?: string
  ) {
    const existing = await this.getAgent(id, organizationId);
    const newVersion = (existing.version || 1) + 1;

    const updated = await aiRepository.updateAgent(id, organizationId, {
      ...data,
      updatedById: userId,
      version: newVersion,
    });

    // Snapshot version if configuration or instructions changed
    if (
      (data.systemInstructions && data.systemInstructions !== existing.systemInstructions) ||
      data.configuration ||
      data.allowedTools
    ) {
      await aiRepository.createAgentVersion({
        agentId: id,
        version: newVersion,
        name: updated.name,
        modelId: updated.modelId,
        systemInstructions: updated.systemInstructions,
        configuration: updated.configuration as Prisma.InputJsonValue,
        allowedTools: (updated.allowedTools ?? []) as Prisma.InputJsonValue,
        allowedCapabilities: (updated.allowedCapabilities ?? []) as Prisma.InputJsonValue,
        createdById: userId,
      });
    }

    return updated;
  }

  public async listAgentVersions(agentId: string, organizationId: string) {
    await this.getAgent(agentId, organizationId);
    return aiRepository.listAgentVersions(agentId);
  }

  // ---------------------------------------------------------------------------
  // Prompts & Versioning
  // ---------------------------------------------------------------------------
  public async listPrompts(organizationId: string, filters: AiListFilters, page = 1, limit = 20) {
    return aiRepository.listPrompts(organizationId, filters, page, limit);
  }

  public async getPrompt(id: string, organizationId: string) {
    const prompt = await aiRepository.findPromptById(id, organizationId);
    if (!prompt) throw new NotFoundError("AI Prompt template not found.");
    return prompt;
  }

  public async createPrompt(organizationId: string, userId: string, data: Prisma.AiPromptUncheckedCreateInput) {
    if (!data.name || !data.template) {
      throw new ValidationError("Prompt name and template are required.");
    }

    const prompt = await aiRepository.createPrompt({
      ...data,
      organizationId,
      createdById: userId,
      updatedById: userId,
      version: 1,
    });

    await aiRepository.createPromptVersion({
      promptId: prompt.id,
      version: 1,
      template: prompt.template,
      systemPrompt: prompt.systemPrompt,
      variables: (prompt.variables ?? []) as Prisma.InputJsonValue,
      outputFormat: prompt.outputFormat,
      createdById: userId,
    });

    return prompt;
  }

  public async updatePrompt(
    id: string,
    organizationId: string,
    userId: string,
    data: Prisma.AiPromptUncheckedUpdateInput,
    _changeNote?: string
  ) {
    const existing = await this.getPrompt(id, organizationId);
    const newVersion = (existing.version || 1) + 1;

    const updated = await aiRepository.updatePrompt(id, organizationId, {
      ...data,
      updatedById: userId,
      version: newVersion,
    });

    if (data.template && data.template !== existing.template) {
      await aiRepository.createPromptVersion({
        promptId: id,
        version: newVersion,
        template: updated.template,
        systemPrompt: updated.systemPrompt,
        variables: (updated.variables ?? []) as Prisma.InputJsonValue,
        outputFormat: updated.outputFormat,
        createdById: userId,
      });
    }

    return updated;
  }

  public async listPromptVersions(promptId: string, organizationId: string) {
    await this.getPrompt(promptId, organizationId);
    return aiRepository.listPromptVersions(promptId);
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------
  public listTools() {
    return Object.values(AI_TOOL_REGISTRY).map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      requiredPermission: t.requiredPermission,
      riskLevel: t.riskLevel,
      requiresApproval: !!t.requiresApproval,
      requiresAudit: !!t.requiresAudit,
      parameters: t.parameters,
    }));
  }

  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: {
      organizationId: string;
      userId: string;
      userPermissions: readonly string[];
      agentName?: string;
    }
  ) {
    return aiToolExecutor.executeTool(toolName, args, {
      organizationId: context.organizationId,
      userId: context.userId,
      userPermissions: context.userPermissions,
      agentName: context.agentName || "Direct Tool Invocation",
    });
  }

  // ---------------------------------------------------------------------------
  // Workflows
  // ---------------------------------------------------------------------------
  public async listWorkflows(organizationId: string, filters: AiListFilters, page = 1, limit = 20) {
    return aiRepository.listWorkflows(organizationId, filters, page, limit);
  }

  public async getWorkflow(id: string, organizationId: string) {
    const workflow = await aiRepository.findWorkflowById(id, organizationId);
    if (!workflow) throw new NotFoundError("AI Workflow not found.");
    return workflow;
  }

  public async createWorkflow(organizationId: string, userId: string, data: Prisma.AiWorkflowUncheckedCreateInput) {
    if (!data.name || !data.steps) {
      throw new ValidationError("Workflow name and steps are required.");
    }
    return aiRepository.createWorkflow({
      ...data,
      organizationId,
      createdById: userId,
      updatedById: userId,
      version: 1,
    });
  }

  public async updateWorkflow(
    id: string,
    organizationId: string,
    userId: string,
    data: Prisma.AiWorkflowUncheckedUpdateInput
  ) {
    await this.getWorkflow(id, organizationId);
    return aiRepository.updateWorkflow(id, organizationId, {
      ...data,
      updatedById: userId,
    });
  }

  public async executeWorkflow(
    id: string,
    organizationId: string,
    userId: string,
    userPermissions: readonly string[],
    inputData: Record<string, unknown>
  ) {
    return aiOrchestrator.executeWorkflow(id, organizationId, userId, userPermissions, inputData);
  }

  // ---------------------------------------------------------------------------
  // Approvals & Human Gates
  // ---------------------------------------------------------------------------
  public async listApprovals(organizationId: string, status?: string, page = 1, limit = 20) {
    return aiRepository.listApprovals(organizationId, status, page, limit);
  }

  public async getApproval(id: string, organizationId: string) {
    const approval = await aiRepository.findApprovalById(id, organizationId);
    if (!approval) throw new NotFoundError("Approval request not found.");
    return approval;
  }

  public async decideApproval(
    id: string,
    organizationId: string,
    userId: string,
    userPermissions: readonly string[],
    decision: "APPROVED" | "REJECTED",
    reason?: string
  ) {
    const approval = await this.getApproval(id, organizationId);
    if (approval.status !== "PENDING") {
      throw new ValidationError(`Approval is already resolved with status ${approval.status}.`);
    }

    const updated = await aiRepository.updateApproval(id, organizationId, {
      status: decision,
      approverId: userId,
      decisionReason: reason || null,
      decidedAt: new Date(),
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: userId,
      actorType: "USER",
      action: decision === "APPROVED" ? "AI_APPROVAL_GRANTED" : "AI_APPROVAL_REJECTED",
      resourceType: "ai_approval",
      resourceId: id,
      metadata: { action: approval.action, reason },
    });

    let executionResult = null;
    // If approved and was tied to a tool action, execute the action!
    if (decision === "APPROVED" && approval.action) {
      const payload = approval.payload as Record<string, unknown> | null;
      if (typeof payload?.toolName === "string") {
        executionResult = await aiToolExecutor.executeTool(
          payload.toolName,
          (payload.args as Record<string, unknown>) || {},
          {
            organizationId,
            userId,
            userPermissions,
            agentName: `Authorized by User (${userId})`,
          }
        );
      }
    }

    return { approval: updated, executionResult };
  }

  // ---------------------------------------------------------------------------
  // Executions
  // ---------------------------------------------------------------------------
  public async listExecutions(organizationId: string, filters: AiListFilters, page = 1, limit = 20) {
    return aiRepository.listExecutions(organizationId, filters, page, limit);
  }

  public async getExecution(id: string, organizationId: string) {
    const execution = await aiRepository.findExecutionById(id, organizationId);
    if (!execution) throw new NotFoundError("AI Execution not found.");
    return execution;
  }

  public async executePrompt(
    organizationId: string,
    userId: string,
    userPermissions: readonly string[],
    params: {
      prompt: string;
      capability?: string;
      agentId?: string;
      modelId?: string;
      providerId?: string;
      systemInstruction?: string;
      variables?: Record<string, string>;
      temperature?: number;
      maxTokens?: number;
    }
  ) {
    return aiOrchestrator.execute({
      organizationId,
      userId,
      userPermissions,
      ...params,
    });
  }
}

export const aiService = new AiService();
