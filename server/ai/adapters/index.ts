export * from "./types";
export * from "./adapterFactory";
export * from "./geminiAdapter";
export * from "./mockAdapter";

import { AdapterFactory } from "./adapterFactory";
export function getAdapter(providerType = "GEMINI", apiKey?: string) {
  return AdapterFactory.getAdapter(providerType, apiKey);
}
