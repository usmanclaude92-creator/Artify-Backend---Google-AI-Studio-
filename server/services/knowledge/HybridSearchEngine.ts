/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Hybrid Search & Permission-Aware Retrieval Engine
 * Combines semantic vector similarity with BM25/keyword ranking,
 * enforces multi-tenant boundary and strict RBAC before returning data.
 */
import { prisma } from "../../db/prisma";
import { EmbeddingService } from "./EmbeddingService";
import type { KnowledgeSearchRequest, SearchResultItem } from "./types";

export interface SearchContext {
  organizationId: string;
  userId?: string;
  userPermissions: string[];
  roleName?: string;
}

export class HybridSearchEngine {
  /**
   * Performs permission-filtered semantic, keyword, or hybrid search.
   */
  public static async search(
    request: KnowledgeSearchRequest,
    context: SearchContext
  ): Promise<SearchResultItem[]> {
    const startTime = Date.now();
    const mode = request.mode || "HYBRID";
    const limit = Math.min(request.limit || 10, 50);
    const minScore = request.minScore ?? 0.15;

    // 1. Fetch accessible active documents for this organization
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        organizationId: context.organizationId,
        status: "INDEXED",
        ...(request.filter?.collectionIds?.length
          ? { collectionId: { in: request.filter.collectionIds } }
          : {}),
        ...(request.filter?.sourceIds?.length
          ? { sourceId: { in: request.filter.sourceIds } }
          : {}),
        ...(request.filter?.documentIds?.length
          ? { id: { in: request.filter.documentIds } }
          : {}),
      },
      include: {
        collection: true,
        source: true,
      },
    });

    if (documents.length === 0) {
      return [];
    }

    // 2. Filter documents by access policy and permissions
    const authorizedDocs = documents.filter((doc) => {
      // Security Scope check
      if (doc.requiredRole && context.roleName && context.roleName !== "ADMIN") {
        if (doc.requiredRole !== context.roleName) {
          return false;
        }
      }

      // Collection Policy check
      if (doc.collection) {
        const col = doc.collection;
        if (col.accessPolicy === "RESTRICTED" || col.accessPolicy === "ROLE_BASED") {
          const allowedRoles = Array.isArray(col.allowedRoles) ? (col.allowedRoles as string[]) : [];
          if (allowedRoles.length > 0 && context.roleName && context.roleName !== "ADMIN") {
            if (!allowedRoles.includes(context.roleName)) {
              return false;
            }
          }
        } else if (col.accessPolicy === "OWNER_ONLY") {
          if (context.userId && col.createdById !== context.userId && context.roleName !== "ADMIN") {
            return false;
          }
        }
      }

      return true;
    });

    if (authorizedDocs.length === 0) {
      return [];
    }

    const docMap = new Map(authorizedDocs.map((d) => [d.id, d]));
    const authorizedDocIds = Array.from(docMap.keys());

    // 3. Fetch chunks for authorized documents
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        organizationId: context.organizationId,
        documentId: { in: authorizedDocIds },
      },
      include: {
        embeddings: true,
      },
      take: 200, // Search over candidate pool
    });

    if (chunks.length === 0) {
      return [];
    }

    // 4. Score chunks
    // Vector search query vector
    let queryVector: number[] = [];
    if (mode === "SEMANTIC" || mode === "HYBRID") {
      queryVector = await EmbeddingService.generateEmbedding(request.query);
    }

    const queryTerms = request.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    const scoredItems: SearchResultItem[] = [];

    for (const chunk of chunks) {
      const doc = docMap.get(chunk.documentId);
      if (!doc) continue;

      // Keyword Scoring (Term frequency & exact match)
      let keywordScore = 0;
      const lowerContent = chunk.content.toLowerCase();
      let matchedTerms = 0;

      for (const term of queryTerms) {
        if (lowerContent.includes(term)) {
          matchedTerms++;
          const occurrences = lowerContent.split(term).length - 1;
          keywordScore += Math.min(occurrences * 0.2, 0.6);
        }
      }

      if (queryTerms.length > 0) {
        keywordScore += (matchedTerms / queryTerms.length) * 0.4;
      }
      keywordScore = Math.min(1.0, keywordScore);

      // Semantic Similarity Scoring
      let similarityScore = 0;
      if ((mode === "SEMANTIC" || mode === "HYBRID") && chunk.embeddings.length > 0) {
        const storedVector = chunk.embeddings[0]?.vector;
        if (Array.isArray(storedVector) && storedVector.length > 0) {
          similarityScore = EmbeddingService.cosineSimilarity(queryVector, storedVector as number[]);
        }
      }

      // Hybrid combination weights: 70% semantic, 30% lexical
      let finalScore = 0;
      if (mode === "SEMANTIC") {
        finalScore = similarityScore;
      } else if (mode === "KEYWORD") {
        finalScore = keywordScore;
      } else {
        finalScore = similarityScore * 0.7 + keywordScore * 0.3;
      }

      if (finalScore >= minScore) {
        scoredItems.push({
          chunkId: chunk.id,
          documentId: doc.id,
          documentTitle: doc.title,
          collectionId: doc.collectionId || undefined,
          collectionName: doc.collection?.name,
          sourceId: doc.sourceId || undefined,
          sourceName: doc.source?.name,
          versionNumber: chunk.versionNumber,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          pageNumber: chunk.pageNumber || undefined,
          sectionHeading: chunk.sectionHeading || undefined,
          similarityScore: Number(similarityScore.toFixed(4)),
          keywordScore: Number(keywordScore.toFixed(4)),
          score: Number(finalScore.toFixed(4)),
          securityScope: doc.securityScope,
          requiredRole: doc.requiredRole || undefined,
          metadata: (chunk.metadata as Record<string, unknown>) || {},
        });
      }
    }

    // Sort descending by score
    scoredItems.sort((a, b) => b.score - a.score);
    const results = scoredItems.slice(0, limit);

    // 5. Asynchronously log search audit
    try {
      await prisma.knowledgeSearchLog.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          query: request.query,
          searchType: mode,
          filterMetadata: (request.filter as any) || {},
          resultsCount: results.length,
          durationMs: Date.now() - startTime,
        },
      });
    } catch {
      // non-blocking
    }

    return results;
  }
}
