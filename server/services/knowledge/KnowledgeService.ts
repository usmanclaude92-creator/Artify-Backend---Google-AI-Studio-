/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Central Knowledge Service Layer
 * Coordinates Document Collections, Sources, Ingestion, Versioning, and Lifecycle.
 */
import crypto from "crypto";
import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../core/errors";
import { logger } from "../../core/logger";
import { ExtractionPipeline } from "./ExtractionPipeline";
import { ChunkingEngine } from "./ChunkingEngine";
import { EmbeddingService } from "./EmbeddingService";
import { HybridSearchEngine } from "./HybridSearchEngine";
import { ContextBuilder } from "./ContextBuilder";
import type {
  KnowledgeAccessPolicy,
  KnowledgeSearchRequest,
  SearchResultItem,
  GroundedContextResult,
  KnowledgeSourceType,
} from "./types";

export class KnowledgeService {
  // ---------------------------------------------------------------------------
  // Collection Management
  // ---------------------------------------------------------------------------
  public static async createCollection(params: {
    organizationId: string;
    userId?: string;
    name: string;
    description?: string;
    accessPolicy?: KnowledgeAccessPolicy;
    allowedRoles?: string[];
    metadata?: Record<string, unknown>;
  }) {
    if (!params.name || params.name.trim().length === 0) {
      throw new ValidationError("Collection name is required.");
    }

    return await prisma.knowledgeCollection.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.userId,
        name: params.name.trim(),
        description: params.description,
        accessPolicy: (params.accessPolicy || "RESTRICTED") as any,
        allowedRoles: params.allowedRoles || [],
        metadata: (params.metadata as any) || {},
        status: "ACTIVE",
      },
    });
  }

  public static async listCollections(organizationId: string) {
    return await prisma.knowledgeCollection.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        _count: {
          select: { documents: true, sources: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  public static async getCollection(id: string, organizationId: string) {
    const col = await prisma.knowledgeCollection.findFirst({
      where: { id, organizationId },
      include: {
        sources: true,
        documents: true,
      },
    });
    if (!col) {
      throw new NotFoundError(`Knowledge Collection "${id}" not found.`);
    }
    return col;
  }

  // ---------------------------------------------------------------------------
  // Source Connectors & Registration
  // ---------------------------------------------------------------------------
  public static async registerSource(params: {
    organizationId: string;
    collectionId?: string;
    name: string;
    sourceType: KnowledgeSourceType;
    entityType?: string;
    entityId?: string;
    config?: Record<string, unknown>;
  }) {
    return await prisma.knowledgeSource.create({
      data: {
        organizationId: params.organizationId,
        collectionId: params.collectionId,
        name: params.name,
        sourceType: params.sourceType as any,
        entityType: params.entityType,
        entityId: params.entityId,
        config: (params.config as any) || {},
        status: "ACTIVE",
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Document Ingestion Pipeline
  // ---------------------------------------------------------------------------
  public static async ingestDocument(params: {
    organizationId: string;
    userId?: string;
    collectionId?: string;
    sourceId?: string;
    title: string;
    description?: string;
    buffer: Buffer;
    mimeType: string;
    filename?: string;
    securityScope?: string;
    requiredRole?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!params.title || params.title.trim().length === 0) {
      throw new ValidationError("Document title is required.");
    }
    if (!params.buffer || params.buffer.length === 0) {
      throw new ValidationError("Document buffer cannot be empty.");
    }

    const checksum = crypto.createHash("sha256").update(params.buffer).digest("hex");

    // Check if document already exists with this title/collection
    const existing = await prisma.knowledgeDocument.findFirst({
      where: {
        organizationId: params.organizationId,
        title: params.title,
        collectionId: params.collectionId,
      },
      include: {
        versions: true,
      },
    });

    let documentId: string;
    let versionNumber = 1;

    if (existing) {
      documentId = existing.id;
      versionNumber = existing.activeVersion + 1;
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          activeVersion: versionNumber,
          status: "PROCESSING",
          indexingStatus: "PROCESSING",
          sizeBytes: params.buffer.length,
          checksum,
          updatedAt: new Date(),
        },
      });
    } else {
      const doc = await prisma.knowledgeDocument.create({
        data: {
          organizationId: params.organizationId,
          createdById: params.userId,
          collectionId: params.collectionId,
          sourceId: params.sourceId,
          title: params.title,
          description: params.description,
          mimeType: params.mimeType,
          sizeBytes: params.buffer.length,
          checksum,
          activeVersion: 1,
          status: "PROCESSING",
          indexingStatus: "PROCESSING",
          securityScope: params.securityScope || "DEFAULT",
          requiredRole: params.requiredRole,
          metadata: (params.metadata as any) || {},
        },
      });
      documentId = doc.id;
      versionNumber = 1;
    }

    // Create Ingestion Job Record
    const job = await prisma.knowledgeIngestionJob.create({
      data: {
        organizationId: params.organizationId,
        documentId,
        versionNumber,
        stage: "EXTRACTING",
        status: "PROCESSING",
        startedAt: new Date(),
      },
    });

    try {
      // 1. Text Extraction
      const extracted = await ExtractionPipeline.extract(params.buffer, params.mimeType, params.filename);

      // 2. Chunking
      const chunks = ChunkingEngine.chunk(extracted.text);

      // 3. Create Document Version Record
      const versionRecord = await prisma.knowledgeDocumentVersion.create({
        data: {
          documentId,
          version: versionNumber,
          mimeType: params.mimeType,
          sizeBytes: params.buffer.length,
          checksum,
          extractedText: extracted.text,
          totalChunks: chunks.length,
          createdById: params.userId,
          metadata: (extracted.metadata as any) || {},
        },
      });

      // Update Job progress
      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "CHUNKING",
          totalChunks: chunks.length,
          progress: 50,
        },
      });

      // 4. Save Chunks & Generate Embeddings
      for (const ch of chunks) {
        const createdChunk = await prisma.knowledgeChunk.create({
          data: {
            organizationId: params.organizationId,
            documentId,
            versionId: versionRecord.id,
            versionNumber,
            chunkIndex: ch.chunkIndex,
            content: ch.content,
            tokenEstimate: ch.tokenEstimate,
            charCount: ch.charCount,
            pageNumber: ch.pageNumber,
            sectionHeading: ch.sectionHeading,
            metadata: (ch.metadata as any) || {},
          },
        });

        const vector = await EmbeddingService.generateEmbedding(ch.content);
        await EmbeddingService.storeEmbedding(createdChunk.id, vector);
      }

      // 5. Finalize Job & Document Status
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: "INDEXED",
          indexingStatus: "INDEXED",
        },
      });

      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "COMPLETED",
          status: "INDEXED",
          progress: 100,
          completedAt: new Date(),
        },
      });

      logger.info({ documentId, versionNumber, chunks: chunks.length }, "[KnowledgeService] Ingestion completed");

      return {
        documentId,
        versionNumber,
        jobId: job.id,
        totalChunks: chunks.length,
        status: "INDEXED",
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Document ingestion failed";
      logger.error({ err, documentId }, "[KnowledgeService] Ingestion failed");

      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: "FAILED", indexingStatus: "FAILED" },
      });

      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "FAILED",
          status: "FAILED",
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });

      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Reindexing & Lifecycle
  // ---------------------------------------------------------------------------
  public static async reindexDocument(documentId: string, organizationId: string) {
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { id: documentId, organizationId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });

    if (!doc || doc.versions.length === 0) {
      throw new NotFoundError(`Document "${documentId}" or its active version not found.`);
    }

    const latestVersion = doc.versions[0];
    if (!latestVersion.extractedText) {
      throw new ValidationError("Cannot reindex document without extracted text.");
    }

    // Delete previous chunks and embeddings for this version
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId, versionNumber: latestVersion.version },
    });

    // Re-chunk and re-embed
    const chunks = ChunkingEngine.chunk(latestVersion.extractedText);
    for (const ch of chunks) {
      const createdChunk = await prisma.knowledgeChunk.create({
        data: {
          organizationId,
          documentId,
          versionId: latestVersion.id,
          versionNumber: latestVersion.version,
          chunkIndex: ch.chunkIndex,
          content: ch.content,
          tokenEstimate: ch.tokenEstimate,
          charCount: ch.charCount,
          pageNumber: ch.pageNumber,
          sectionHeading: ch.sectionHeading,
          metadata: (ch.metadata as any) || {},
        },
      });

      const vector = await EmbeddingService.generateEmbedding(ch.content);
      await EmbeddingService.storeEmbedding(createdChunk.id, vector);
    }

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "INDEXED", indexingStatus: "INDEXED", updatedAt: new Date() },
    });

    return { documentId, chunksReindexed: chunks.length };
  }

  // ---------------------------------------------------------------------------
  // Retrieval & Grounding
  // ---------------------------------------------------------------------------
  public static async search(
    request: KnowledgeSearchRequest,
    context: {
      organizationId: string;
      userId?: string;
      userPermissions: string[];
      roleName?: string;
    }
  ): Promise<SearchResultItem[]> {
    return await HybridSearchEngine.search(request, context);
  }

  public static async getGroundedContext(
    query: string,
    context: {
      organizationId: string;
      userId?: string;
      userPermissions: string[];
      roleName?: string;
    },
    options?: { maxTokens?: number; minScore?: number; filter?: KnowledgeSearchRequest["filter"] }
  ): Promise<GroundedContextResult> {
    const results = await HybridSearchEngine.search(
      {
        query,
        mode: "HYBRID",
        minScore: options?.minScore ?? 0.15,
        limit: 10,
        filter: options?.filter,
      },
      context
    );

    return ContextBuilder.buildContext(results, {
      maxTokens: options?.maxTokens ?? 2500,
      minScoreThreshold: options?.minScore ?? 0.15,
      detectConflicts: true,
    });
  }
}
