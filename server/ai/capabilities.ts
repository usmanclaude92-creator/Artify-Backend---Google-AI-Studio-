/**
 * AI Capabilities Registry (Phase 12 — docs/AI_ARCHITECTURE.md).
 * System definitions for all platform-supported AI capabilities and their resolution policies.
 */

export interface CapabilityDefinition {
  id: string;
  name: string;
  category: "GENERATION" | "ANALYSIS" | "AUTOMATION" | "TRANSFORMATION";
  description: string;
  recommendedModelType: "CHAT" | "COMPLETION" | "EMBEDDING" | "MULTIMODAL";
  supportsStreaming: boolean;
  requiresVision?: boolean;
  requiresTools?: boolean;
}

export const AI_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "TEXT_GENERATION",
    name: "Text Generation",
    category: "GENERATION",
    description: "Multi-turn dialogue, creative drafting, instruction following, and general text synthesis.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "SUMMARIZATION",
    name: "Summarization",
    category: "ANALYSIS",
    description: "Condensing large documents, meeting transcripts, CRM notes, and contracts into executive briefings.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "CLASSIFICATION",
    name: "Classification",
    category: "ANALYSIS",
    description: "Categorizing leads, sentiment analysis, compliance labeling, and urgency tagging.",
    recommendedModelType: "CHAT",
    supportsStreaming: false,
  },
  {
    id: "EXTRACTION",
    name: "Extraction",
    category: "TRANSFORMATION",
    description: "Extracting entities, tables, dates, and domain objects into strongly validated JSON structures.",
    recommendedModelType: "CHAT",
    supportsStreaming: false,
  },
  {
    id: "TRANSLATION",
    name: "Translation & Localization",
    category: "TRANSFORMATION",
    description: "High-fidelity translation across regional languages while preserving tone and industry terminology.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "EMBEDDINGS",
    name: "Semantic Embeddings",
    category: "TRANSFORMATION",
    description: "Generating high-dimensional vector representations for semantic similarity and retrieval.",
    recommendedModelType: "EMBEDDING",
    supportsStreaming: false,
  },
  {
    id: "DOCUMENT_ANALYSIS",
    name: "Document Analysis",
    category: "ANALYSIS",
    description: "Deep reading, clause extraction, policy auditing, and Q&A over complex structured documents.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "IMAGE_ANALYSIS",
    name: "Image & Vision Analysis",
    category: "ANALYSIS",
    description: "Visual understanding, OCR, asset tagging, and visual quality auditing for media assets.",
    recommendedModelType: "MULTIMODAL",
    supportsStreaming: false,
    requiresVision: true,
  },
  {
    id: "STRUCTURED_OUTPUT",
    name: "Structured Output (JSON Schema)",
    category: "GENERATION",
    description: "Enforcing guaranteed JSON response schema adherence for downstream system consumption.",
    recommendedModelType: "CHAT",
    supportsStreaming: false,
  },
  {
    id: "FUNCTION_CALLING",
    name: "Function & Tool Calling",
    category: "AUTOMATION",
    description: "Selecting and formulating arguments for registered enterprise tools and CRM services.",
    recommendedModelType: "CHAT",
    supportsStreaming: false,
    requiresTools: true,
  },
  {
    id: "DATA_ANALYSIS",
    name: "Data & Financial Reasoning",
    category: "ANALYSIS",
    description: "Mathematical reasoning, commercial margin auditing, trend forecasting, and tabular analysis.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "CODE_ASSISTANCE",
    name: "Code Assistance & Scripts",
    category: "GENERATION",
    description: "Generating, reviewing, and explaining SQL queries, templates, and integration scripts.",
    recommendedModelType: "CHAT",
    supportsStreaming: true,
  },
  {
    id: "WORKFLOW_AUTOMATION",
    name: "Workflow & Plan Chaining",
    category: "AUTOMATION",
    description: "Autonomous multi-step decomposition, tool selection, error recovery, and approval orchestration.",
    recommendedModelType: "CHAT",
    supportsStreaming: false,
    requiresTools: true,
  },
] as const;

export type AiCapabilityKey = (typeof AI_CAPABILITIES)[number]["id"];

export function getCapability(id: string): CapabilityDefinition | undefined {
  return AI_CAPABILITIES.find((c) => c.id === id);
}

export function isValidCapability(id: string): boolean {
  return AI_CAPABILITIES.some((c) => c.id === id);
}
