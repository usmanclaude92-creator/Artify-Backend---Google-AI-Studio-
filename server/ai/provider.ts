/**
 * Pluggable AI provider abstraction. Ported from the Phase 0 audit's
 * artifysolscom/server/ai/provider.ts (docs/MIGRATION_PLAN.md — REUSE).
 * The API key is read only from server-side config (server/config/env.ts)
 * and is never sent to, or readable by, any frontend — confirmed absent
 * from both repos' client bundles during the Phase 0 audit
 * (docs/ADR/ADR-007-ai-governance.md).
 *
 * No AI business route is mounted in Phase 1 (see server/ai/tools.ts for
 * why) — this module exists so Phase 12 has a tested provider to build on,
 * not a route to call today.
 */
import { GoogleGenAI } from "@google/genai";
import { config } from "../config/env";
import { InfrastructureError } from "../core/errors";
import { logger } from "../core/logger";

export interface AiPromptOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  generateText(prompt: string, options?: AiPromptOptions): Promise<string>;
}

const GEMINI_MODEL = "gemini-3.7-flash";

class GeminiProvider implements AiProvider {
  public readonly name = `Google Gemini (${GEMINI_MODEL})`;
  private client: GoogleGenAI | null = null;

  public get available(): boolean {
    return config.aiProvider === "gemini" && config.geminiApiKey.length > 0;
  }

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;
    if (!this.available) {
      throw new InfrastructureError("AI provider is not configured (GEMINI_API_KEY missing).");
    }
    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    return this.client;
  }

  public async generateText(prompt: string, options?: AiPromptOptions): Promise<string> {
    const client = this.getClient();

    try {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.3,
          maxOutputTokens: options?.maxOutputTokens ?? 2048,
          responseMimeType: options?.responseMimeType,
        },
      });

      const text = response.text;
      if (!text) {
        throw new InfrastructureError("Empty response received from the AI provider.");
      }
      return text;
    } catch (err) {
      logger.error({ err, event: "ai_provider_error" }, "AI provider call failed");
      throw err instanceof InfrastructureError ? err : new InfrastructureError("AI provider call failed.");
    }
  }
}

class UnavailableProvider implements AiProvider {
  public readonly name = "none";
  public readonly available = false;
  public async generateText(): Promise<string> {
    throw new InfrastructureError("AI provider is not configured.");
  }
}

export const defaultAiProvider: AiProvider = config.aiProvider === "gemini" ? new GeminiProvider() : new UnavailableProvider();
