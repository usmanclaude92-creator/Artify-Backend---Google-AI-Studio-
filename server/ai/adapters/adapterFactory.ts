/**
 * Adapter Factory (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Instantiates provider adapters based on database provider configuration.
 */
import type { AiModelAdapter } from "./types";
import { GeminiAdapter } from "./geminiAdapter";
import { MockAdapter } from "./mockAdapter";
import { config } from "../../config/env";

export class AdapterFactory {
  private static mockInstance = new MockAdapter();
  private static geminiInstance: GeminiAdapter | null = null;

  public static getAdapter(providerType: string, apiKey?: string): AiModelAdapter {
    const normalized = (providerType || "GEMINI").toUpperCase();

    if (normalized === "MOCK") {
      return this.mockInstance;
    }

    if (normalized === "GEMINI") {
      // If Gemini API key is missing, provide safe mock fallback in development
      const key = apiKey || config.geminiApiKey;
      if (!key || key.length === 0) {
        return this.mockInstance;
      }
      if (!this.geminiInstance || apiKey) {
        const adapter = new GeminiAdapter(key);
        if (!apiKey) this.geminiInstance = adapter;
        return adapter;
      }
      return this.geminiInstance;
    }

    // Default to mock for unimplemented third-party types (OPENAI, ANTHROPIC, CUSTOM)
    return this.mockInstance;
  }
}
