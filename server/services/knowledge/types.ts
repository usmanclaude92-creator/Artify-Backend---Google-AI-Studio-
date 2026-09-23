/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Domain Types, Enums & Interfaces
 */

export type KnowledgeAccessPolicy = "PUBLIC" | "RESTRICTED" | "ROLE_BASED" | "OWNER_ONLY";

export type KnowledgeSourceType =
  | "UPLOADED_DOCUMENT"
  | "MEDIA_ASSET"
  | "CMS_CONTENT"
  | "CRM_CLIENT"
  | "CRM_LEAD"
  | "PROJECT"
  | "PRODUCT_CATALOG"
  | "BILLING_RECORD"
  | "MANUAL_ENTRY"
  | "EXTERNAL_CONNECTOR";

export type KnowledgeDocumentStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "EXTRACTED"
  | "CHUNKED"
  | "INDEXING"
  | "INDEXED"
  | "FAILED"
  | "ARCHIVED";

export type KnowledgeJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "INDEXED"
  | "STALE"
  | "FAILED"
  | "REINDEX_REQUIRED";

export type SearchMode = "SEMANTIC" | "KEYWORD" | "HYBRID";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  charCount: number;
  pageNumber?: number;
  sectionHeading?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDocument {
  text: string;
  mimeType: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
    extractedAt: string;
    characterCount: number;
    wordCount: number;
    format: string;
  };
}

export interface KnowledgeSearchFilter {
  collectionIds?: string[];
  sourceIds?: string[];
  documentIds?: string[];
  entityTypes?: string[];
  documentTypes?: string[];
  statuses?: KnowledgeDocumentStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface SearchResultItem {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  collectionId?: string;
  collectionName?: string;
  sourceId?: string;
  sourceName?: string;
  versionNumber: number;
  chunkIndex: number;
  content: string;
  pageNumber?: number;
  sectionHeading?: string;
  similarityScore: number;
  keywordScore: number;
  score: number;
  securityScope: string;
  requiredRole?: string;
  metadata: Record<string, unknown>;
}

export interface KnowledgeSearchRequest {
  query: string;
  mode?: SearchMode;
  filter?: KnowledgeSearchFilter;
  limit?: number;
  minScore?: number;
  includeContent?: boolean;
}

export interface KnowledgeCitation {
  sourceName: string;
  documentTitle: string;
  documentId: string;
  version: number;
  pageNumber?: number;
  sectionHeading?: string;
  chunkIndex: number;
  similarityScore: number;
}

export interface GroundedContextResult {
  formattedContext: string;
  citations: KnowledgeCitation[];
  totalChunksUsed: number;
  totalTokensEstimate: number;
  conflictingSourcesDetected: boolean;
  conflictsSummary?: string;
  retrievedChunks: SearchResultItem[];
}
