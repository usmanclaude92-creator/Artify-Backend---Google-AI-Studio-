/**
 * Controlled AI tool-execution framework (architectural boundary only —
 * Phase 1 §21 explicitly forbids building AI business workflows yet).
 * Ported from the Phase 0 audit's artifysolscom/server/ai/tools.ts design
 * (docs/ADR/ADR-007-ai-governance.md — this was the best-designed
 * subsystem found in the audit and is REUSEd, not rebuilt).
 *
 * The governing rule this module exists to enforce: an AI coworker can
 * NEVER execute arbitrary SQL, shell commands, filesystem access, or
 * unrestricted network requests. Every action it can take must be a
 * registered `AiToolDefinition` with an explicit required permission,
 * validated input, and an audit-log write on every execution attempt
 * (success or failure). No tools are registered yet — Phase 12 adds the
 * first real ones (searchArticles, createDraft, etc., mirroring the
 * Phase 0 prototype's registry) once the services they call exist.
 */
import type { PermissionKey } from "../types/domain";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { NotImplementedError } from "../core/errors";
import { logger } from "../core/logger";

export interface AiToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  requiredPermission: PermissionKey;
  parameters: AiToolParameterSchema;
}

export interface AiToolExecutionContext {
  organizationId: string;
  agentId: string;
  agentName: string;
  taskId?: string;
  requestId?: string;
}

export interface AiToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Intentionally empty in Phase 1 — see module doc comment. */
export const AI_TOOL_REGISTRY: Readonly<Record<string, AiToolDefinition>> = Object.freeze({});

export class AiToolExecutor {
  /**
   * Executes a registered tool by name. Always writes an audit log entry
   * (success or failure) before returning — an AI-attributed action must
   * never be invisible to `audit.read`.
   */
  public async executeTool(
    toolName: string,
    _args: Record<string, unknown>,
    context: AiToolExecutionContext
  ): Promise<AiToolExecutionResult> {
    const definition = AI_TOOL_REGISTRY[toolName];

    await auditLogRepository.record({
      organizationId: context.organizationId,
      // actorUserId is FK'd to users.id — an AI coworker is not a user
      // row, so its identity goes in actorName/metadata instead, never in
      // actorUserId (that FK must only ever reference a real human user).
      actorName: context.agentName,
      actorType: "AI_COWORKER",
      action: "AI_TOOL_EXECUTION_ATTEMPT",
      resourceType: "ai_tool",
      resourceId: toolName,
      metadata: { agentId: context.agentId, taskId: context.taskId, found: !!definition },
      requestId: context.requestId,
    });

    if (!definition) {
      logger.warn({ event: "ai_tool_not_registered", toolName }, "AI attempted to call an unregistered tool");
      return { success: false, error: `Tool "${toolName}" is not registered.` };
    }

    // No tool implementations exist yet (Phase 12) — reaching here for a
    // *registered* tool would be a bug once tools exist, so it fails loudly
    // rather than silently no-op-ing.
    throw new NotImplementedError(`Tool "${toolName}" is registered but has no implementation yet.`);
  }
}

export const aiToolExecutor = new AiToolExecutor();
