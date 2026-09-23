/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Semantic & Structural Document Chunking Engine
 * Preserves headings, paragraphs, lists, tables, and page boundaries with configurable overlap.
 */
import type { DocumentChunk } from "./types";

export interface ChunkingOptions {
  maxChunkSize?: number; // target character count (default 1000)
  overlapSize?: number; // character overlap (default 150)
  preserveHeadings?: boolean;
}

export class ChunkingEngine {
  /**
   * Chunks a normalized document string into structured chunks with metadata.
   */
  public static chunk(text: string, options: ChunkingOptions = {}): DocumentChunk[] {
    const maxChunkSize = options.maxChunkSize || 1000;
    const overlapSize = options.overlapSize || 150;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const cleanText = text.replace(/\r\n/g, "\n");
    // Split by logical sections: markdown headers (#, ##), double line breaks, or numbered sections
    const rawSections = cleanText.split(/\n{2,}/);
    const chunks: DocumentChunk[] = [];

    let currentBuffer = "";
    let currentHeading: string | undefined = undefined;
    let currentPage = 1;
    let chunkIndex = 0;

    for (const section of rawSections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // Detect heading
      if (trimmed.startsWith("#") || /^[A-Z0-9\s-]{3,30}:?$/.test(trimmed.split("\n")[0] || "")) {
        currentHeading = trimmed.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 100);
      }

      // Check for page markers
      const pageMatch = trimmed.match(/\[PAGE\s*(\d+)\]|--- Page (\d+) ---/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1] || pageMatch[2] || "1", 10);
      }

      if (currentBuffer.length + trimmed.length + 1 > maxChunkSize && currentBuffer.length > 0) {
        // Finalize current chunk
        const tokenEstimate = Math.max(1, Math.ceil(currentBuffer.length / 4));
        chunks.push({
          chunkIndex,
          content: currentBuffer.trim(),
          tokenEstimate,
          charCount: currentBuffer.length,
          pageNumber: currentPage,
          sectionHeading: currentHeading,
          metadata: {
            estimatedTokens: tokenEstimate,
            chunkSeq: chunkIndex,
          },
        });
        chunkIndex++;

        // Carry overlap from end of current buffer
        const overlap = currentBuffer.slice(-overlapSize).trim();
        currentBuffer = overlap ? `${overlap}\n\n${trimmed}` : trimmed;
      } else {
        currentBuffer = currentBuffer ? `${currentBuffer}\n\n${trimmed}` : trimmed;
      }

      // If a single section is larger than maxChunkSize, split sentences
      while (currentBuffer.length > maxChunkSize * 1.5) {
        const splitPoint = currentBuffer.lastIndexOf(". ", maxChunkSize);
        const cut = splitPoint > 200 ? splitPoint + 1 : maxChunkSize;
        const part = currentBuffer.slice(0, cut).trim();
        const remainder = currentBuffer.slice(cut).trim();

        const tokenEstimate = Math.max(1, Math.ceil(part.length / 4));
        chunks.push({
          chunkIndex,
          content: part,
          tokenEstimate,
          charCount: part.length,
          pageNumber: currentPage,
          sectionHeading: currentHeading,
        });
        chunkIndex++;
        currentBuffer = remainder;
      }
    }

    if (currentBuffer.trim().length > 0) {
      const tokenEstimate = Math.max(1, Math.ceil(currentBuffer.length / 4));
      chunks.push({
        chunkIndex,
        content: currentBuffer.trim(),
        tokenEstimate,
        charCount: currentBuffer.length,
        pageNumber: currentPage,
        sectionHeading: currentHeading,
      });
    }

    return chunks;
  }
}
