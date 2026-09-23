/**
 * AI Adapter Layer Types (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Pluggable provider-agnostic interfaces for model invocation.
 */

export interface AiToolCallRequest {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiModelCallParams {
  modelName: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  responseMimeType?: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
}

export interface AiModelCallResult {
  text: string;
  structuredData?: unknown;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  finishReason?: string;
  toolCalls?: AiToolCallRequest[];
}

export interface AiModelAdapter {
  readonly providerType: string;
  generateText(params: AiModelCallParams): Promise<AiModelCallResult>;
  generateStructured<T = unknown>(params: AiModelCallParams): Promise<T>;
  generateEmbedding?(params: { text: string; modelName?: string; dimension?: number }): Promise<number[]>;
}
