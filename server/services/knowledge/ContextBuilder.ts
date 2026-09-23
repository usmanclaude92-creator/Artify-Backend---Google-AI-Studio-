/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Context Builder & Citation Formatter
 * Formats retrieved chunks into bounded, cited prompt injection blocks for AI Orchestrator.
 */
import type { GroundedContextResult, SearchResultItem, KnowledgeCitation } from "./types";

export interface ContextBuilderOptions {
  maxTokens?: number; // default 2500 tokens
  minScoreThreshold?: number; // default 0.20
  detectConflicts?: boolean;
}

export class ContextBuilder {
  /**
   * Transforms search results into a safe, cited context block for AI prompt augmentation.
   */
  public static buildContext(
    chunks: SearchResultItem[],
    options: ContextBuilderOptions = {}
  ): GroundedContextResult {
    const maxTokens = options.maxTokens || 2500;
    const threshold = options.minScoreThreshold ?? 0.2;

    const filtered = chunks.filter((c) => c.score >= threshold);
    const citations: KnowledgeCitation[] = [];
    const contextBlocks: string[] = [];

    let currentTokenEstimate = 0;
    const sourcesSeen = new Map<string, string>(); // documentTitle -> sample text for conflict check

    let conflictsDetected = false;
    const conflictNotes: string[] = [];

    for (let i = 0; i < filtered.length; i++) {
      const chunk = filtered[i];
      const chunkTokens = Math.max(1, Math.ceil(chunk.content.length / 4));

      if (currentTokenEstimate + chunkTokens > maxTokens) {
        break;
      }

      // Check potential conflicts across different documents
      if (options.detectConflicts !== false) {
        for (const [title, prevContent] of sourcesSeen.entries()) {
          if (title !== chunk.documentTitle) {
            // Check for obvious polar contradictions (e.g. "not permitted" vs "permitted", "discontinued" vs "active")
            if (
              (chunk.content.toLowerCase().includes("not allowed") && prevContent.toLowerCase().includes("allowed")) ||
              (chunk.content.toLowerCase().includes("deprecated") && prevContent.toLowerCase().includes("supported"))
            ) {
              conflictsDetected = true;
              conflictNotes.push(`Potential conflict between "${title}" and "${chunk.documentTitle}"`);
            }
          }
        }
        sourcesSeen.set(chunk.documentTitle, chunk.content);
      }

      citations.push({
        sourceName: chunk.sourceName || "Knowledge Base",
        documentTitle: chunk.documentTitle,
        documentId: chunk.documentId,
        version: chunk.versionNumber,
        pageNumber: chunk.pageNumber,
        sectionHeading: chunk.sectionHeading,
        chunkIndex: chunk.chunkIndex,
        similarityScore: chunk.score,
      });

      const refTag = `[REF-${i + 1}]`;
      const location = chunk.pageNumber ? `(Page ${chunk.pageNumber})` : chunk.sectionHeading ? `(${chunk.sectionHeading})` : "";
      contextBlocks.push(
        `${refTag} [Source: ${chunk.documentTitle} ${location} | Score: ${(chunk.score * 100).toFixed(0)}%]\n${chunk.content}`
      );

      currentTokenEstimate += chunkTokens;
    }

    const formattedContext = contextBlocks.length > 0
      ? `--- ENTERPRISE KNOWLEDGE CONTEXT ---\nThe following verified organizational documents were retrieved with high relevance:\n\n${contextBlocks.join("\n\n")}\n--- END ENTERPRISE KNOWLEDGE CONTEXT ---`
      : "";

    return {
      formattedContext,
      citations,
      totalChunksUsed: contextBlocks.length,
      totalTokensEstimate: currentTokenEstimate,
      conflictingSourcesDetected: conflictsDetected,
      conflictsSummary: conflictNotes.length > 0 ? conflictNotes.join("; ") : undefined,
      retrievedChunks: filtered.slice(0, contextBlocks.length),
    };
  }
}
