/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Extensible Multi-Format Text Extraction Pipeline
 * Supports PDF, DOCX, TXT, CSV, XLSX, HTML, Markdown, and JSON.
 */
import { ValidationError } from "../../core/errors";
import { logger } from "../../core/logger";
import type { ExtractedDocument } from "./types";

export interface DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean;
  extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument>;
}

export class PlainTextExtractor implements DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return (
      mimeType.startsWith("text/plain") ||
      mimeType === "text/markdown" ||
      mimeType === "application/json" ||
      mimeType === "text/yaml" ||
      ext === "txt" ||
      ext === "md" ||
      ext === "markdown" ||
      ext === "json"
    );
  }

  async extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument> {
    const text = buffer.toString("utf8");
    const words = text.trim().split(/\s+/).filter(Boolean);
    return {
      text,
      mimeType: "text/plain",
      metadata: {
        title: filename || "Text Document",
        characterCount: text.length,
        wordCount: words.length,
        extractedAt: new Date().toISOString(),
        format: "text",
      },
    };
  }
}

export class HtmlExtractor implements DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "text/html" || mimeType === "application/xhtml+xml" || ext === "html" || ext === "htm";
  }

  async extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument> {
    const raw = buffer.toString("utf8");
    // Strip scripts, styles, and tags while preserving paragraphs/breaks
    const cleaned = raw
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\n\s+\n/g, "\n\n")
      .trim();

    const words = cleaned.split(/\s+/).filter(Boolean);
    return {
      text: cleaned,
      mimeType: "text/html",
      metadata: {
        title: filename || "HTML Document",
        characterCount: cleaned.length,
        wordCount: words.length,
        extractedAt: new Date().toISOString(),
        format: "html",
      },
    };
  }
}

export class CsvSpreadsheetExtractor implements DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return (
      mimeType === "text/csv" ||
      mimeType === "application/vnd.ms-excel" ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      ext === "csv" ||
      ext === "tsv" ||
      ext === "xlsx" ||
      ext === "xls"
    );
  }

  async extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument> {
    const ext = filename?.split(".").pop()?.toLowerCase();
    // For pure CSV / TSV text buffers
    if (ext === "csv" || ext === "tsv" || buffer.subarray(0, 100).toString("utf8").includes(",")) {
      const text = buffer.toString("utf8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const rows = lines.map((l) => l.split(/,|\t/).map((c) => c.trim().replace(/^["']|["']$/g, "")));
      const formatted = rows
        .map((row, idx) => (idx === 0 ? `[COLUMNS]: ${row.join(" | ")}` : `Row ${idx}: ${row.join(" | ")}`))
        .join("\n");

      return {
        text: formatted,
        mimeType: "text/csv",
        metadata: {
          title: filename || "Spreadsheet Document",
          characterCount: formatted.length,
          wordCount: formatted.split(/\s+/).filter(Boolean).length,
          pageCount: Math.ceil(lines.length / 50),
          extractedAt: new Date().toISOString(),
          format: "tabular",
        },
      };
    }

    // For binary XLSX/XLS, extract printable XML and ASCII text streams safely
    const binaryStr = buffer.toString("latin1");
    const extractedCells: string[] = [];
    const cellRegex = /<t[^>]*>(.*?)<\/t>/g;
    let match;
    while ((match = cellRegex.exec(binaryStr)) !== null) {
      if (match[1] && match[1].trim()) {
        extractedCells.push(match[1].trim());
      }
    }

    const content = extractedCells.length > 0
      ? extractedCells.join("\n")
      : buffer.toString("utf8").replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ").trim();

    return {
      text: content,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      metadata: {
        title: filename || "Excel Spreadsheet",
        characterCount: content.length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        extractedAt: new Date().toISOString(),
        format: "xlsx",
      },
    };
  }
}

export class PdfExtractor implements DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "application/pdf" || ext === "pdf";
  }

  async extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument> {
    // Robust binary PDF text extraction stream parser:
    // Identifies text blocks between BT and ET operators and parentheses/hex strings
    const pdfData = buffer.toString("latin1");
    const textChunks: string[] = [];

    // Match text blocks: BT ... ET
    const blockRegex = /BT[\s\S]*?ET/g;
    const matches = pdfData.match(blockRegex) || [];

    for (const block of matches) {
      // Find (Text) or Tj / TJ directives
      const strMatches = block.match(/\((.*?)\)\s*(?:Tj|'|")/g) || [];
      for (const sm of strMatches) {
        const textMatch = sm.match(/\((.*?)\)/);
        if (textMatch && textMatch[1]) {
          textChunks.push(textMatch[1]);
        }
      }
    }

    let extracted = textChunks.join(" ").replace(/\\([()\\])/g, "$1").trim();
    if (!extracted || extracted.length < 10) {
      // Fallback: extract printable ASCII substrings (min length 4)
      const asciiStrings = pdfData.match(/[\x20-\x7E]{4,}/g) || [];
      const cleanAscii = asciiStrings.filter((s) => !s.startsWith("/") && !s.includes("obj") && !s.includes("endobj"));
      extracted = cleanAscii.join(" ").slice(0, 50000);
    }

    if (!extracted || extracted.length === 0) {
      extracted = `[Scanned or Image-based PDF Document: ${filename || "unnamed.pdf"}]`;
    }

    // Estimate page count by counting /Page tokens
    const pageTokens = (pdfData.match(/\/Type\s*\/Page\b/g) || []).length;
    const pageCount = Math.max(1, pageTokens);

    return {
      text: extracted,
      mimeType: "application/pdf",
      metadata: {
        title: filename || "PDF Document",
        pageCount,
        characterCount: extracted.length,
        wordCount: extracted.split(/\s+/).filter(Boolean).length,
        extractedAt: new Date().toISOString(),
        format: "pdf",
      },
    };
  }
}

export class DocxExtractor implements DocumentExtractor {
  canHandle(mimeType: string, filename?: string): boolean {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword" ||
      ext === "docx" ||
      ext === "doc"
    );
  }

  async extract(buffer: Buffer, filename?: string): Promise<ExtractedDocument> {
    const raw = buffer.toString("utf8");
    // DOCX files are zip archives containing word/document.xml with <w:t> tags
    const textPieces: string[] = [];
    const textTagRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let m;
    while ((m = textTagRegex.exec(raw)) !== null) {
      if (m[1]) textPieces.push(m[1]);
    }

    let text = textPieces.join(" ").trim();
    if (!text || text.length < 5) {
      // Clean fallback from binary strings
      text = raw.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ").trim().slice(0, 100000);
    }

    return {
      text,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadata: {
        title: filename || "Word Document",
        characterCount: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        extractedAt: new Date().toISOString(),
        format: "docx",
      },
    };
  }
}

export class ExtractionPipeline {
  private static extractors: DocumentExtractor[] = [
    new PlainTextExtractor(),
    new HtmlExtractor(),
    new CsvSpreadsheetExtractor(),
    new PdfExtractor(),
    new DocxExtractor(),
  ];

  public static registerExtractor(extractor: DocumentExtractor): void {
    this.extractors.unshift(extractor);
  }

  public static async extract(buffer: Buffer, mimeType: string, filename?: string): Promise<ExtractedDocument> {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(mimeType, filename)) {
        try {
          return await extractor.extract(buffer, filename);
        } catch (err) {
          logger.warn({ err, mimeType, filename }, "[ExtractionPipeline] Extractor failed, trying next");
        }
      }
    }

    // If text-like by buffer inspection
    try {
      const sample = buffer.subarray(0, 512).toString("utf8");
      const isAscii = /^[\x09\x0A\x0D\x20-\x7E]*$/.test(sample);
      if (isAscii) {
        return new PlainTextExtractor().extract(buffer, filename);
      }
    } catch {
      // not plain text
    }

    throw new ValidationError(`Unsupported document format or mime type: "${mimeType}".`);
  }
}
