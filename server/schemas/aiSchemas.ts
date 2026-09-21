/**
 * Zod validation schemas for AI Control Center (Phase 12).
 */
import { z } from "zod";

export const listAiQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
  capability: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  agentId: z.string().optional(),
});

export const createAiProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: z.enum(["GEMINI", "OPENAI", "ANTHROPIC", "MOCK", "CUSTOM"]),
  baseUrl: z.string().url().optional().nullable(),
  credentialRef: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE", "ERROR", "RATE_LIMITED"]).default("ACTIVE"),
  isDefault: z.boolean().default(false),
  supportedCapabilities: z.array(z.string()).default([]),
  configuration: z.record(z.unknown()).default({}),
});

export const updateAiProviderSchema = createAiProviderSchema.partial();

export const createAiModelSchema = z.object({
  providerId: z.string().min(1),
  modelName: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100),
  modelType: z.enum(["CHAT", "COMPLETION", "EMBEDDING", "MULTIMODAL"]).default("CHAT"),
  contextLimit: z.number().int().min(1).default(128000),
  inputCapabilities: z.array(z.string()).default(["TEXT"]),
  outputCapabilities: z.array(z.string()).default(["TEXT"]),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  supportsEmbedding: z.boolean().default(false),
  status: z.enum(["ACTIVE", "DEPRECATED", "DISABLED"]).default("ACTIVE"),
  isDefault: z.boolean().default(false),
  configMetadata: z.record(z.unknown()).default({}),
});

export const updateAiModelSchema = createAiModelSchema.partial();

export const createAiAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED", "SUSPENDED"]).default("ACTIVE"),
  systemInstructions: z.string().min(1),
  modelId: z.string().optional().nullable(),
  configuration: z.record(z.unknown()).default({}),
  allowedTools: z.array(z.string()).default([]),
  allowedCapabilities: z.array(z.string()).default([]),
  knowledgeSources: z.array(z.string()).default([]),
  maxExecutionTime: z.number().int().min(1).max(300).default(60),
  maxTokenLimit: z.number().int().min(100).max(32000).default(4096),
  retryPolicy: z.record(z.unknown()).default({ maxRetries: 2, backoffMs: 500 }),
  requireApproval: z.boolean().default(false),
});

export const updateAiAgentSchema = createAiAgentSchema.partial().extend({
  changeNote: z.string().optional(),
});

export const createAiPromptSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  category: z.string().default("GENERAL"),
  systemPrompt: z.string().optional().nullable(),
  template: z.string().min(1),
  variables: z.array(z.string()).default([]),
  outputFormat: z.enum(["TEXT", "JSON", "MARKDOWN", "STRUCTURED"]).default("TEXT"),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  isActiveVersion: z.boolean().default(true),
});

export const updateAiPromptSchema = createAiPromptSchema.partial().extend({
  changeNote: z.string().optional(),
});

export const createAiWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  trigger: z.enum(["MANUAL", "EVENT", "SCHEDULE", "WEBHOOK"]).default("MANUAL"),
  steps: z.array(z.record(z.unknown())).min(1),
  conditions: z.record(z.unknown()).default({}),
  agentId: z.string().optional().nullable(),
  tools: z.array(z.string()).default([]),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  requireApproval: z.boolean().default(false),
  retryPolicy: z.record(z.unknown()).default({ maxRetries: 1, backoffMs: 1000 }),
  timeout: z.number().int().min(1).max(600).default(60),
  status: z.enum(["ACTIVE", "DRAFT", "DISABLED", "ARCHIVED"]).default("ACTIVE"),
});

export const updateAiWorkflowSchema = createAiWorkflowSchema.partial();

export const executePromptSchema = z.object({
  prompt: z.string().min(1),
  capability: z.string().optional(),
  agentId: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  systemInstruction: z.string().optional(),
  variables: z.record(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(16384).optional(),
});

export const executeWorkflowSchema = z.object({
  input: z.record(z.unknown()).default({}),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional(),
});

export const executeToolSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});
