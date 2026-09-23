/**
 * Phase 13: Autonomous AI Workflows & Business Automation — Domain Types
 */

import { z } from "zod";

// -----------------------------------------------------------------------------
// Event System Types
// -----------------------------------------------------------------------------

export type BusinessActorType = "USER" | "SYSTEM" | "AI" | "WEBHOOK";

export interface BusinessEventPayload<T = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  organizationId: string;
  actorId?: string;
  actorType: BusinessActorType;
  timestamp: string;
  payload: T;
  correlationId: string;
  sourceModule: string;
}

export interface EventRegistration {
  eventType: string;
  entityType: string;
  sourceModule: string;
  description: string;
  payloadSchema?: z.ZodTypeAny;
}

// -----------------------------------------------------------------------------
// Condition Engine Types
// -----------------------------------------------------------------------------

export type ConditionOperator =
  | "="
  | "=="
  | "==="
  | "!="
  | "!=="
  | ">"
  | ">="
  | "<"
  | "<="
  | "IN"
  | "NOT_IN"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "IS_EMPTY"
  | "IS_NOT_EMPTY"
  | "STARTS_WITH"
  | "ENDS_WITH";

export interface SingleCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  conditions: (SingleCondition | ConditionGroup)[];
}

export type WorkflowCondition = SingleCondition | ConditionGroup;

// -----------------------------------------------------------------------------
// Workflow Step Types
// -----------------------------------------------------------------------------

export type StepType =
  | "CONDITION"
  | "AI_DECISION"
  | "AI_GENERATION"
  | "TOOL_CALL"
  | "BUSINESS_ACTION"
  | "APPROVAL"
  | "NOTIFICATION"
  | "DELAY"
  | "LOOP"
  | "TRANSFORM"
  | "KNOWLEDGE_RETRIEVAL";

export interface BaseStepConfig {
  id: string;
  name: string;
  type: StepType;
  description?: string;
  retryOnFailure?: boolean;
  maxRetries?: number;
}

export interface ConditionStepConfig extends BaseStepConfig {
  type: "CONDITION";
  condition: WorkflowCondition;
  thenStepId?: string;
  elseStepId?: string;
}

export interface AiDecisionStepConfig extends BaseStepConfig {
  type: "AI_DECISION";
  agentId?: string;
  modelId?: string;
  prompt: string;
  contextFields?: string[];
  expectedSchema?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AiGenerationStepConfig extends BaseStepConfig {
  type: "AI_GENERATION";
  agentId?: string;
  modelId?: string;
  prompt: string;
  outputKey: string;
  useKnowledgeBase?: boolean;
  knowledgeFilter?: {
    collectionIds?: string[];
    sourceIds?: string[];
  };
}

export interface ToolCallStepConfig extends BaseStepConfig {
  type: "TOOL_CALL";
  toolName: string;
  argumentsTemplate: Record<string, unknown>;
  outputKey?: string;
}

export interface BusinessActionStepConfig extends BaseStepConfig {
  type: "BUSINESS_ACTION";
  actionId: string;
  parameters: Record<string, unknown>;
  outputKey?: string;
  requireApproval?: boolean;
}

export interface ApprovalStepConfig extends BaseStepConfig {
  type: "APPROVAL";
  actionDescription: string;
  requiredRole?: string;
  payloadSummaryTemplate?: string;
  timeoutMinutes?: number;
  autoRejectOnTimeout?: boolean;
}

export interface NotificationStepConfig extends BaseStepConfig {
  type: "NOTIFICATION";
  channel: "IN_APP" | "EMAIL" | "SMS" | "WEBHOOK";
  recipientRole?: string;
  recipientUserId?: string;
  titleTemplate: string;
  messageTemplate: string;
  level?: "INFO" | "WARNING" | "ERROR" | "SUCCESS";
}

export interface DelayStepConfig extends BaseStepConfig {
  type: "DELAY";
  durationSeconds: number;
}

export interface LoopStepConfig extends BaseStepConfig {
  type: "LOOP";
  itemsPath: string;
  itemVariableName: string;
  maxIterations?: number;
  stepIds: string[];
}

export interface TransformStepConfig extends BaseStepConfig {
  type: "TRANSFORM";
  mappings: Record<string, string>;
  outputKey: string;
}

export interface KnowledgeRetrievalStepConfig extends BaseStepConfig {
  type: "KNOWLEDGE_RETRIEVAL";
  queryTemplate: string;
  collectionIds?: string[];
  maxResults?: number;
  outputKey: string;
}

export type WorkflowStepConfig =
  | ConditionStepConfig
  | AiDecisionStepConfig
  | AiGenerationStepConfig
  | ToolCallStepConfig
  | BusinessActionStepConfig
  | ApprovalStepConfig
  | NotificationStepConfig
  | DelayStepConfig
  | LoopStepConfig
  | TransformStepConfig
  | KnowledgeRetrievalStepConfig;

// -----------------------------------------------------------------------------
// Trigger Types
// -----------------------------------------------------------------------------

export type WorkflowTriggerType = "EVENT" | "SCHEDULE" | "MANUAL" | "API" | "CONDITIONAL";

export interface EventTriggerConfig {
  eventType: string;
  filterCondition?: WorkflowCondition;
}

export interface ScheduleTriggerConfig {
  scheduleType: "ONE_TIME" | "RECURRING" | "CRON";
  cronExpression?: string;
  intervalSeconds?: number;
  timezone?: string;
}

export interface ConditionalTriggerConfig {
  entityType: string;
  condition: WorkflowCondition;
}

export type WorkflowTriggerConfig =
  | EventTriggerConfig
  | ScheduleTriggerConfig
  | ConditionalTriggerConfig
  | Record<string, unknown>;

// -----------------------------------------------------------------------------
// Business Action Definition
// -----------------------------------------------------------------------------

export interface BusinessActionDefinition<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  requiredPermission: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiresApproval: boolean;
  requiresAudit: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (
    input: TInput,
    context: {
      organizationId: string;
      userId?: string;
      workflowId?: string;
      executionId?: string;
      stepId?: string;
      correlationId: string;
    }
  ) => Promise<TOutput>;
}

// -----------------------------------------------------------------------------
// Structured AI Decision Output Schema
// -----------------------------------------------------------------------------

export const StructuredAiDecisionSchema = z.object({
  decision: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  recommended_action: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type StructuredAiDecision = z.infer<typeof StructuredAiDecisionSchema>;

// -----------------------------------------------------------------------------
// Execution & Resource Limits
// -----------------------------------------------------------------------------

export interface WorkflowLimits {
  maxSteps: number;
  maxDurationMs: number;
  maxAiCalls: number;
  maxToolCalls: number;
  maxLoopIterations: number;
}

export const DEFAULT_WORKFLOW_LIMITS: WorkflowLimits = {
  maxSteps: 50,
  maxDurationMs: 300000, // 5 minutes
  maxAiCalls: 10,
  maxToolCalls: 15,
  maxLoopIterations: 10,
};

export interface WorkflowRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  exponential: boolean;
}

export const DEFAULT_RETRY_POLICY: WorkflowRetryPolicy = {
  maxRetries: 2,
  backoffMs: 1000,
  exponential: true,
};
