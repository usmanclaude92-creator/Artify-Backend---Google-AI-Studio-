/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * REST API Routes for Knowledge Collections, Sources, Documents, and Retrieval
 */
import { Router } from "express";
import express from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { KnowledgeService } from "../../services/knowledge/KnowledgeService";
import { prisma } from "../../db/prisma";
import { NotFoundError } from "../../core/errors";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
router.get("/collections", requirePermission("knowledge.read"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const collections = await KnowledgeService.listCollections(orgId);
    res.json({ success: true, data: collections });
  } catch (err) {
    next(err);
  }
});

router.post("/collections", requirePermission("knowledge.create"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const collection = await KnowledgeService.createCollection({
      organizationId: orgId,
      userId: req.user!.id,
      name: req.body.name,
      description: req.body.description,
      accessPolicy: req.body.accessPolicy,
      allowedRoles: req.body.allowedRoles,
      metadata: req.body.metadata,
    });
    res.status(201).json({ success: true, data: collection });
  } catch (err) {
    next(err);
  }
});

router.get("/collections/:id", requirePermission("knowledge.read"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const collection = await KnowledgeService.getCollection(req.params.id, orgId);
    res.json({ success: true, data: collection });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
router.post("/sources", requirePermission("knowledge.create"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const source = await KnowledgeService.registerSource({
      organizationId: orgId,
      collectionId: req.body.collectionId,
      name: req.body.name,
      sourceType: req.body.sourceType,
      entityType: req.body.entityType,
      entityId: req.body.entityId,
      config: req.body.config,
    });
    res.status(201).json({ success: true, data: source });
  } catch (err) {
    next(err);
  }
});

router.get("/sources", requirePermission("knowledge.read"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const sources = await prisma.knowledgeSource.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: {
        collection: true,
        _count: { select: { documents: true } },
      },
    });
    res.json({ success: true, data: sources });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
router.get("/documents", requirePermission("knowledge.read"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { collectionId, sourceId, status } = req.query;

    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        organizationId: orgId,
        ...(collectionId ? { collectionId: String(collectionId) } : {}),
        ...(sourceId ? { sourceId: String(sourceId) } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        collection: true,
        source: true,
        _count: { select: { chunks: true, versions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: documents });
  } catch (err) {
    next(err);
  }
});

router.get("/documents/:id", requirePermission("knowledge.read"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: {
        collection: true,
        source: true,
        versions: { orderBy: { version: "desc" } },
        ingestionJobs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!document) {
      throw new NotFoundError(`Document "${req.params.id}" not found.`);
    }
    res.json({ success: true, data: document });
  } catch (err) {
    next(err);
  }
});

// Ingest / Upload Document (supports direct text/raw payload or base64 file upload)
router.post(
  "/documents/upload",
  requirePermission("knowledge.upload"),
  express.json({ limit: "25mb" }),
  async (req, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      const { text, contentBase64, mimeType, filename, title, description, collectionId, sourceId, securityScope, requiredRole, metadata } = req.body;

      let buffer: Buffer;
      const finalMime = mimeType || "text/plain";

      if (contentBase64) {
        buffer = Buffer.from(contentBase64, "base64");
      } else if (text !== undefined && text !== null) {
        buffer = Buffer.from(String(text), "utf8");
      } else {
        res.status(400).json({ success: false, error: "Either text or contentBase64 is required." });
        return;
      }

      const result = await KnowledgeService.ingestDocument({
        organizationId: orgId,
        userId: req.user!.id,
        collectionId,
        sourceId,
        title: title || filename || "Untitled Document",
        description,
        buffer,
        mimeType: finalMime,
        filename,
        securityScope,
        requiredRole,
        metadata: metadata || {},
      });

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/documents/:id/reindex", requirePermission("knowledge.reindex"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const result = await KnowledgeService.reindexDocument(req.params.id, orgId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Search & Retrieval (RAG query endpoint)
// ---------------------------------------------------------------------------
router.post("/search", requirePermission("knowledge.search"), async (req, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    const { query, mode, limit, minScore, filter } = req.body;

    const results = await KnowledgeService.search(
      {
        query: String(query || ""),
        mode: mode || "HYBRID",
        limit: limit ? parseInt(String(limit), 10) : 10,
        minScore: minScore !== undefined ? parseFloat(String(minScore)) : 0.15,
        filter,
      },
      {
        organizationId: orgId,
        userId: req.user!.id,
        userPermissions: req.user!.role.permissions || [],
        roleName: req.user!.role.key,
      }
    );

    res.json({ success: true, data: results, count: results.length });
  } catch (err) {
    next(err);
  }
});

export { router as knowledgeRoutes };
