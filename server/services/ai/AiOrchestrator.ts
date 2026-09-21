/**
 * AI Orchestrator (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Responsible for prompt hydration, agent instruction compilation, tool dispatch,
 * execution monitoring, error handling, token accounting, and human approval enforcement.
 */
import { aiRepository } from "../../repositories/aiRepository";
import { AdapterFactory } from "../../ai/adapters/adapterFactory";
import { aiToolExecutor } from "../../ai/tools";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { logger } from "../../core/logger";
import { ValidationError } from "../../core/errors";

export interface ExecutePromptRequest {
  organizationId: string;
  userId: string;
  userPermissions: readonly string[];
  prompt: string;
  capability?: string;
  providerId?: string;
  modelId?: string;
  agentId?: string;
  workflowId?: string;
  systemInstruction?: string;
  variables?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
}

export interface ExecutionResponse {
  executionId: string;
  status: "COMPLETED" | "FAILED" | "PENDING_APPROVAL" | "WAITING_APPROVAL";
  output: string;
  structuredOutput?: unknown;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  estimatedCost: number;
  approvalId?: string;
  requiresApproval?: boolean;
}

export class AiOrchestrator {
  /**
   * Hydrates template variables in the form of {{var_name}}.
   */
  public static interpolateVariables(template: string, vars: Record<string, unknown> = {}): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
    });
  }

  /**
   * Executes an AI generation request through the unified orchestrator pipeline.
   */
  public async execute(req: ExecutePromptRequest): Promise<ExecutionResponse> {
    const startTime = Date.now();
    const capability = req.capability || "TEXT_GENERATION";

    // 1. Resolve Agent if specified
    let agent = null;
    if (req.agentId) {
      agent = await aiRepository.findAgentById(req.agentId, req.organizationId);
      if (!agent) {
        throw new ValidationError(`Agent ${req.agentId} not found in this organization.`);
      }
      if (agent.status !== "ACTIVE") {
        throw new ValidationError(`Agent ${agent.name} is currently suspended or inactive.`);
      }
    }

    // 2. Resolve Model & Provider
    let model = null;
    let provider = null;

    if (req.modelId) {
      model = await aiRepository.findModelById(req.modelId);
    } else if (agent?.modelId) {
      model = await aiRepository.findModelById(agent.modelId);
    }

    if (!model) {
      model = await aiRepository.findDefaultModel(req.providerId);
    }

    if (model?.providerId) {
      provider = await aiRepository.findProviderById(model.providerId, req.organizationId);
    }
    if (!provider && req.providerId) {
      provider = await aiRepository.findProviderById(req.providerId, req.organizationId);
    }
    if (!provider) {
      provider = await aiRepository.findDefaultProvider(req.organizationId);
    }

    const providerType = provider?.providerType || "GEMINI";
    const modelName = model?.modelName || "gemini-2.5-flash";

    // 3. Compile prompt and system instructions
    let finalPrompt = req.prompt;
    if (req.variables && Object.keys(req.variables).length > 0) {
      finalPrompt = AiOrchestrator.interpolateVariables(finalPrompt, req.variables);
    }

    let finalSystemInstruction = req.systemInstruction;
    if (agent?.systemInstructions) {
      finalSystemInstruction = agent.systemInstructions + (req.systemInstruction ? `\n\n${req.systemInstruction}` : "");
    }

    // 4. Create in-flight execution record
    const execution = await aiRepository.createExecution({
      organizationId: req.organizationId,
      agentId: agent?.id ?? null,
      workflowId: req.workflowId ?? null,
      providerId: provider?.id ?? null,
      modelId: model?.id ?? null,
      capability,
      status: "RUNNING",
      startedAt: new Date(),
      inputMetadata: {
        promptLength: finalPrompt.length,
        promptPreview: finalPrompt.slice(0, 300),
        capability,
      },
      initiatorUserId: req.userId,
      trigger: "MANUAL",
    });

    try {
      // 5. Check if agent requires approval for execution
      if (agent?.requireApproval) {
        const approval = await aiRepository.createApproval({
          organizationId: req.organizationId,
          agentId: agent.id,
          workflowId: req.workflowId ?? null,
          executionId: execution.id,
          requesterId: agent.id,
          action: "AGENT_PROMPT_EXECUTION",
          payload: { prompt: finalPrompt, capability },
          status: "PENDING",
          requestedAt: new Date(),
        });

        await aiRepository.updateExecution(execution.id, {
          status: "WAITING_APPROVAL",
          approvalStatus: "PENDING",
        });

        return {
          executionId: execution.id,
          status: "WAITING_APPROVAL",
          output: "Execution has been queued and is waiting for designated human authorization.",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - startTime,
          estimatedCost: 0,
          approvalId: approval.id,
          requiresApproval: true,
        };
      }

      // 6. Invoke Adapter
      const adapter = AdapterFactory.getAdapter(providerType);
      const agentConfig = (agent?.configuration as Record<string, unknown> | null) ?? {};
      const callResult = await adapter.generateText({
        modelName,
        prompt: finalPrompt,
        systemInstruction: finalSystemInstruction,
        temperature: req.temperature ?? (typeof agentConfig.temperature === "number" ? agentConfig.temperature : 0.3),
        maxTokens: req.maxTokens ?? (typeof agentConfig.maxTokens === "number" ? agentConfig.maxTokens : 2048),
      });

      const durationMs = Date.now() - startTime;

      // 7. Calculate cost
      const costConfig = (model?.configMetadata as Record<string, unknown> | null) ?? {};
      const inRate = typeof costConfig.costPer1kInputTokens === "number" ? costConfig.costPer1kInputTokens : 0.0001;
      const outRate = typeof costConfig.costPer1kOutputTokens === "number" ? costConfig.costPer1kOutputTokens : 0.0004;
      const estimatedCost = Number(
        ((callResult.inputTokens / 1000) * inRate + (callResult.outputTokens / 1000) * outRate).toFixed(6)
      );

      // 8. Update execution record with success
      await aiRepository.updateExecution(execution.id, {
        status: "COMPLETED",
        completedAt: new Date(),
        durationMs,
        outputMetadata: {
          preview: callResult.text.slice(0, 300),
          finishReason: callResult.finishReason,
        },
        inputTokens: callResult.inputTokens,
        outputTokens: callResult.outputTokens,
        totalTokens: callResult.totalTokens,
        estimatedCost,
      });

      // 9. Write audit record
      await auditLogRepository.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        actorType: "USER",
        action: "AI_EXECUTION_COMPLETED",
        resourceType: "ai_execution",
        resourceId: execution.id,
        metadata: {
          capability,
          modelName,
          providerType,
          totalTokens: callResult.totalTokens,
          durationMs,
        },
      });

      return {
        executionId: execution.id,
        status: "COMPLETED",
        output: callResult.text,
        inputTokens: callResult.inputTokens,
        outputTokens: callResult.outputTokens,
        totalTokens: callResult.totalTokens,
        durationMs,
        estimatedCost,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : "AI execution failed unexpectedly.";

      logger.error({ err, executionId: execution.id, event: "ai_orchestrator_failure" }, "Execution failed");

      await aiRepository.updateExecution(execution.id, {
        status: "FAILED",
        completedAt: new Date(),
        durationMs,
        errorMessage: errorMsg,
      });

      await auditLogRepository.record({
        organizationId: req.organizationId,
        actorUserId: req.userId,
        actorType: "USER",
        action: "AI_EXECUTION_FAILED",
        resourceType: "ai_execution",
        resourceId: execution.id,
        metadata: { capability, error: errorMsg },
      });

      return {
        executionId: execution.id,
        status: "FAILED",
        output: `Execution failure: ${errorMsg}`,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs,
        estimatedCost: 0,
      };
    }
  }

  /**
   * Executes an autonomous multi-step workflow.
   */
  public async executeWorkflow(
    workflowId: string,
    organizationId: string,
    userId: string,
    userPermissions: readonly string[],
    inputData: Record<string, unknown>
  ): Promise<{
    workflowId: string;
    name: string;
    completedSteps: number;
    totalSteps: number;
    logs: Record<string, unknown>[];
    finalOutput: Record<string, unknown>;
  }> {
    const workflow = await aiRepository.findWorkflowById(workflowId, organizationId);
    if (!workflow) {
      throw new ValidationError(`Workflow ${workflowId} not found.`);
    }
    if (workflow.status !== "ACTIVE") {
      throw new ValidationError(`Workflow "${workflow.name}" is not active.`);
    }

    const steps = (Array.isArray(workflow.steps) ? workflow.steps : []) as Record<string, unknown>[];
    const executionLogs: Record<string, unknown>[] = [];
    let currentContext = { ...inputData };

    for (const step of steps) {
      const stepStartTime = Date.now();
      try {
        if (typeof step.tool === "string") {
          // Tool dispatch step
          const toolResult = await aiToolExecutor.executeTool(
            step.tool,
            currentContext,
            {
              organizationId,
              userId,
              userPermissions,
              agentId: workflow.agentId ?? undefined,
              agentName: workflow.agent?.name ?? "Workflow Engine",
            }
          );
          executionLogs.push({
            step: step.step || step.name,
            type: "TOOL",
            tool: step.tool,
            durationMs: Date.now() - stepStartTime,
            result: toolResult,
          });
          if (toolResult.data) {
            currentContext = { ...currentContext, [step.tool]: toolResult.data };
          }
        } else if (step.agentId || workflow.agentId) {
          // Agent prompt step
          const targetAgentId = ((step.agentId as string) || workflow.agentId) ?? undefined;
          const prompt = step.prompt
            ? AiOrchestrator.interpolateVariables(String(step.prompt), currentContext)
            : `Process data for step "${String(step.name)}": ${JSON.stringify(currentContext)}`;

          const stepResult = await this.execute({
            organizationId,
            userId,
            userPermissions,
            agentId: targetAgentId,
            workflowId: workflow.id,
            prompt,
            capability: (step.capability as string) || "WORKFLOW_AUTOMATION",
          });

          executionLogs.push({
            step: step.step || step.name,
            type: "AGENT",
            durationMs: Date.now() - stepStartTime,
            output: stepResult.output,
          });
          const stepKey = String(step.name || "agent_output");
          currentContext = { ...currentContext, [stepKey]: stepResult.output };
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Workflow step failed";
        executionLogs.push({
          step: step.step || step.name,
          error: errorMsg,
          durationMs: Date.now() - stepStartTime,
        });
        break;
      }
    }

    return {
      workflowId: workflow.id,
      name: workflow.name,
      completedSteps: executionLogs.length,
      totalSteps: steps.length,
      logs: executionLogs,
      finalOutput: currentContext,
    };
  }
}

export const aiOrchestrator = new AiOrchestrator();
