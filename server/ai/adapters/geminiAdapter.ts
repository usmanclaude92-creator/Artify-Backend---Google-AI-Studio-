/**
 * Google Gemini Provider Adapter (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Uses @google/genai SDK with safe error isolation and telemetry token counts.
 */
import { GoogleGenAI } from "@google/genai";
import type { AiModelAdapter, AiModelCallParams, AiModelCallResult } from "./types";
import { config } from "../../config/env";
import { InfrastructureError } from "../../core/errors";
import { logger } from "../../core/logger";

export class GeminiAdapter implements AiModelAdapter {
  public readonly providerType = "GEMINI";
  private client: GoogleGenAI | null = null;
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : config.geminiApiKey;
  }

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;
    if (!this.apiKey || this.apiKey.length === 0) {
      throw new InfrastructureError("Gemini API key is not configured in server environment.");
    }
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  public async generateText(params: AiModelCallParams): Promise<AiModelCallResult> {
    const start = Date.now();
    const client = this.getClient();
    const model = params.modelName || "gemini-2.5-flash";

    try {
      const response = await client.models.generateContent({
        model,
        contents: params.prompt,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature ?? 0.3,
          maxOutputTokens: params.maxTokens ?? 2048,
          responseMimeType: params.responseMimeType,
          stopSequences: params.stopSequences,
        },
      });

      const durationMs = Date.now() - start;
      const text = response.text || "";

      // Extract token metadata if available from SDK
      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.max(1, Math.ceil(params.prompt.length / 4));
      const outputTokens = usage?.candidatesTokenCount ?? Math.max(1, Math.ceil(text.length / 4));
      const totalTokens = usage?.totalTokenCount ?? inputTokens + outputTokens;

      return {
        text,
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        finishReason: "STOP",
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      logger.error({ err, model, durationMs, event: "gemini_adapter_error" }, "Gemini invocation failed");
      const message = err instanceof Error ? err.message : "Gemini provider call failed.";
      throw new InfrastructureError(`Gemini error: ${message}`);
    }
  }

  public async generateStructured<T = unknown>(params: AiModelCallParams): Promise<T> {
    const res = await this.generateText({
      ...params,
      responseMimeType: "application/json",
    });

    try {
      const clean = res.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(clean) as T;
    } catch {
      throw new InfrastructureError(`Failed to parse structured JSON output: ${res.text.slice(0, 100)}...`);
    }
  }

  public async generateEmbedding(params: { text: string; modelName?: string; dimension?: number }): Promise<number[]> {
    const client = this.getClient();
    const model = params.modelName || "text-embedding-004";
    try {
      const response = await client.models.embedContent({
        model,
        contents: params.text,
      });
      const values = response.embedding?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
      throw new Error("No embedding values returned from Gemini model.");
    } catch (err) {
      logger.error({ err, model }, "Gemini embedding invocation failed");
      const message = err instanceof Error ? err.message : "Gemini embedContent failed.";
      throw new InfrastructureError(`Gemini embedding error: ${message}`);
    }
  }
}
