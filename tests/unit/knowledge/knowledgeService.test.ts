/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Comprehensive Integration & Security Test Suite
 *
 * Verifies:
 * 1. Document Ingestion across formats (txt, markdown, json, csv, etc.)
 * 2. Semantic Chunking & Deterministic/Vector Embeddings
 * 3. Multi-Tenant Isolation (Tenant A cannot see Tenant B's documents)
 * 4. Strict Role-Based Access Control & Permission Enforcement (knowledge.read, knowledge.upload, knowledge.search)
 * 5. Grounded Prompt Context Augmentation in AiOrchestrator with verified citations
 * 6. Autonomous Workflow Engine KNOWLEDGE_RETRIEVAL and AI_GENERATION with grounding
 * 7. AI Tool Execution via searchKnowledgeBase
 * 8. Document Versioning & Reindexing lifecycle
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../../server/app/app";
import { resetDb } from "../../helpers/db";
import { KnowledgeService } from "../../../server/services/knowledge/KnowledgeService";
import { ExtractionPipeline } from "../../../server/services/knowledge/ExtractionPipeline";
import { ChunkingEngine } from "../../../server/services/knowledge/ChunkingEngine";
import { EmbeddingService } from "../../../server/services/knowledge/EmbeddingService";
import { HybridSearchEngine } from "../../../server/services/knowledge/HybridSearchEngine";
import { ContextBuilder } from "../../../server/services/knowledge/ContextBuilder";
import { aiOrchestrator } from "../../../server/services/ai/AiOrchestrator";
import { aiToolExecutor } from "../../../server/ai/tools";
import { workflowEngine } from "../../../server/services/automation/WorkflowEngine";
import { prisma } from "../../../server/db/prisma";

describe("Phase 14 — Enterprise Knowledge, Document Intelligence & RAG", () => {
  const app = createApp();
  finalizeApp(app);

  let adminTokenA: string;
  let orgIdA: string;
  let adminUserIdA: string;
  let otherOrgToken: string;
  let otherOrgId: string;

  beforeAll(async () => {
    await resetDb();

    // Register tenant A admin
    const regA = await request(app).post("/api/v1/auth/register").send({
      email: "knowledge-admin-a@artify.test",
      password: "Password123!Secure",
      firstName: "Knowledge",
      lastName: "AdminA",
      organizationName: "Knowledge Corp A",
    });
    adminTokenA = regA.body.data.session.token;
    orgIdA = regA.body.data.user.organizationId;
    adminUserIdA = regA.body.data.user.id;

    // Register tenant B admin
    const regB = await request(app).post("/api/v1/auth/register").send({
      email: "knowledge-admin-b@artify.test",
      password: "Password123!Secure",
      firstName: "Knowledge",
      lastName: "AdminB",
      organizationName: "Knowledge Corp B",
    });
    otherOrgToken = regB.body.data.session.token;
    otherOrgId = regB.body.data.user.organizationId;
  });

  describe("1. Document Ingestion & Multi-Format Extraction", () => {
    it("extracts text from plain text and markdown buffers", async () => {
      const markdownBuffer = Buffer.from(
        "# Enterprise Security Policy\n\nAll staff must use MFA.\n\n## Data Classification\nConfidential data must be encrypted.",
        "utf8"
      );
      const extracted = await ExtractionPipeline.extract(markdownBuffer, "text/markdown", "policy.md");

      expect(extracted.text).toContain("Enterprise Security Policy");
      expect(extracted.text).toContain("Confidential data must be encrypted.");
      expect(extracted.metadata.characterCount).toBeGreaterThan(50);
      expect(extracted.metadata.wordCount).toBeGreaterThan(10);
    });

    it("extracts tabular data from CSV buffers", async () => {
      const csvBuffer = Buffer.from("id,service,sla_hours\n1,Enterprise,2\n2,Standard,24", "utf8");
      const extracted = await ExtractionPipeline.extract(csvBuffer, "text/csv", "sla.csv");

      expect(extracted.text).toContain("[COLUMNS]: id | service | sla_hours");
      expect(extracted.text).toContain("Row 1: 1 | Enterprise | 2");
      expect(extracted.metadata.format).toBe("tabular");
    });

    it("extracts text cleanly from HTML buffers", async () => {
      const htmlBuffer = Buffer.from(
        "<html><body><h1>Return Policy</h1><p>Customers may return items within 30 days.</p></body></html>",
        "utf8"
      );
      const extracted = await ExtractionPipeline.extract(htmlBuffer, "text/html", "returns.html");

      expect(extracted.text).toContain("Return Policy");
      expect(extracted.text).toContain("Customers may return items within 30 days.");
      expect(extracted.text).not.toContain("<html>");
    });
  });

  describe("2. Document Chunking & Vector Embeddings", () => {
    it("splits long structured text into overlapping chunks with headings preserved", () => {
      const content = `
# Executive Overview
This document outlines standard operating procedures for cloud infrastructure deployment.

## Deployment Guidelines
All deployments must undergo automated CI tests and static analysis.
No manual pushes directly to production branches are allowed.

## Incident Escalation
In case of P1 outages, page on-call SRE immediately.
      `.trim();

      const chunks = ChunkingEngine.chunk(content, { maxChunkSize: 150, overlapSize: 30 });
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].content).toContain("Executive Overview");
      expect(chunks[0].tokenEstimate).toBeGreaterThan(0);
      expect(chunks[1].sectionHeading).toBeDefined();
    });

    it("generates and compares deterministic normalized embeddings", async () => {
      const vec1 = await EmbeddingService.generateEmbedding("Cloud infrastructure deployment guide");
      const vec2 = await EmbeddingService.generateEmbedding("Cloud infrastructure deployment guide");
      const vec3 = await EmbeddingService.generateEmbedding("Culinary recipes for Italian pasta");

      expect(vec1.length).toBe(768);
      // Identical text produces identical vectors (cosine similarity 1.0)
      const simIdentical = EmbeddingService.cosineSimilarity(vec1, vec2);
      expect(simIdentical).toBeCloseTo(1.0, 4);

      // Dissimilar text produces lower similarity
      const simDifferent = EmbeddingService.cosineSimilarity(vec1, vec3);
      expect(simDifferent).toBeLessThan(simIdentical);
    });
  });

  describe("3. Ingestion Pipeline, Collections, and Versioning", () => {
    it("ingests a document into a collection, chunks it, and indexes it", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        userId: adminUserIdA,
        name: "Engineering Handbooks",
        accessPolicy: "PUBLIC",
      });

      const buffer = Buffer.from(
        "# Server Maintenance\nScheduled maintenance windows are on Saturdays at 02:00 UTC.\nBackups run daily at midnight.",
        "utf8"
      );

      const ingestion = await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        userId: adminUserIdA,
        collectionId: col.id,
        title: "Server Maintenance Guide",
        buffer,
        mimeType: "text/markdown",
        filename: "maintenance.md",
      });

      expect(ingestion.documentId).toBeDefined();
      expect(ingestion.versionNumber).toBe(1);
      expect(ingestion.status).toBe("INDEXED");
      expect(ingestion.totalChunks).toBeGreaterThan(0);

      // Verify DB records
      const doc = await prisma.knowledgeDocument.findUnique({ where: { id: ingestion.documentId } });
      expect(doc?.status).toBe("INDEXED");
      expect(doc?.activeVersion).toBe(1);

      // Verify versions and chunks
      const versions = await prisma.knowledgeDocumentVersion.findMany({ where: { documentId: ingestion.documentId } });
      expect(versions.length).toBe(1);

      const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: ingestion.documentId } });
      expect(chunks.length).toBe(ingestion.totalChunks);
    });

    it("creates a new version upon re-uploading with the same title", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        userId: adminUserIdA,
        name: "Legal Documents",
        accessPolicy: "PUBLIC",
      });

      const v1Buffer = Buffer.from("Terms v1: Standard 1-year warranty.", "utf8");
      const v2Buffer = Buffer.from("Terms v2: Extended 2-year warranty with premium support.", "utf8");

      const ing1 = await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        userId: adminUserIdA,
        collectionId: col.id,
        title: "Warranty Agreement",
        buffer: v1Buffer,
        mimeType: "text/plain",
      });

      expect(ing1.versionNumber).toBe(1);

      const ing2 = await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        userId: adminUserIdA,
        collectionId: col.id,
        title: "Warranty Agreement",
        buffer: v2Buffer,
        mimeType: "text/plain",
      });

      expect(ing2.documentId).toBe(ing1.documentId);
      expect(ing2.versionNumber).toBe(2);

      const doc = await prisma.knowledgeDocument.findUnique({ where: { id: ing1.documentId } });
      expect(doc?.activeVersion).toBe(2);
    });
  });

  describe("4. Multi-Tenant Isolation & Permission-Aware Retrieval", () => {
    it("ensures Organization B cannot retrieve Organization A's documents", async () => {
      // Ingest document in Org A
      const colA = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        userId: adminUserIdA,
        name: "Org A Confidential Roadmap",
        accessPolicy: "PUBLIC",
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        userId: adminUserIdA,
        collectionId: colA.id,
        title: "Project Alpha Stealth Strategy",
        buffer: Buffer.from("Project Alpha is targeting launch in Q4 with stealth market dominance.", "utf8"),
        mimeType: "text/plain",
      });

      // Search from Org A -> Should find it
      const resultsA = await KnowledgeService.search(
        { query: "Project Alpha stealth launch" },
        { organizationId: orgIdA, userId: adminUserIdA, userPermissions: ["*"] }
      );
      expect(resultsA.length).toBeGreaterThan(0);
      expect(resultsA[0].documentTitle).toBe("Project Alpha Stealth Strategy");

      // Search from Org B with same query -> Must NOT find anything
      const resultsB = await KnowledgeService.search(
        { query: "Project Alpha stealth launch" },
        { organizationId: otherOrgId, userPermissions: ["*"] }
      );
      expect(resultsB.length).toBe(0);
    });

    it("enforces role-based collection restrictions within the same tenant", async () => {
      // Collection restricted to ADMIN only
      const restrictedCol = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        userId: adminUserIdA,
        name: "Executive Compensation",
        accessPolicy: "ROLE_BASED",
        allowedRoles: ["ADMIN"],
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        userId: adminUserIdA,
        collectionId: restrictedCol.id,
        title: "Executive Bonus Matrix",
        buffer: Buffer.from("Executive performance bonus multiplier is 2.5x base salary.", "utf8"),
        mimeType: "text/plain",
      });

      // Admin user can retrieve
      const adminResults = await KnowledgeService.search(
        { query: "Executive performance bonus" },
        { organizationId: orgIdA, userId: adminUserIdA, userPermissions: ["*"], roleName: "ADMIN" }
      );
      expect(adminResults.length).toBeGreaterThan(0);

      // Viewer user is blocked by collection RBAC
      const viewerResults = await KnowledgeService.search(
        { query: "Executive performance bonus" },
        { organizationId: orgIdA, userPermissions: ["knowledge.search"], roleName: "VIEWER" }
      );
      expect(viewerResults.length).toBe(0);
    });
  });

  describe("5. Grounded Prompt Augmentation & Citation Formatter", () => {
    it("formats retrieved chunks with reference tags and source citations", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        name: "HR Policies",
        accessPolicy: "PUBLIC",
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        collectionId: col.id,
        title: "Paid Time Off Policy",
        buffer: Buffer.from("Full-time employees receive 25 days of annual paid leave.", "utf8"),
        mimeType: "text/plain",
      });

      const groundedContext = await KnowledgeService.getGroundedContext(
        "How many days of annual leave do employees receive?",
        { organizationId: orgIdA, userPermissions: ["*"] }
      );

      expect(groundedContext.formattedContext).toContain("--- ENTERPRISE KNOWLEDGE CONTEXT ---");
      expect(groundedContext.formattedContext).toContain("[REF-1]");
      expect(groundedContext.formattedContext).toContain("Paid Time Off Policy");
      expect(groundedContext.citations.length).toBeGreaterThan(0);
      expect(groundedContext.citations[0].documentTitle).toBe("Paid Time Off Policy");
    });

    it("augments AiOrchestrator prompt with grounded knowledge context and returns citations", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        name: "Compliance",
        accessPolicy: "PUBLIC",
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        collectionId: col.id,
        title: "SOC 2 Encryption Standards",
        buffer: Buffer.from("All databases must enforce AES-256 encryption at rest and TLS 1.3 in transit.", "utf8"),
        mimeType: "text/plain",
      });

      const response = await aiOrchestrator.execute({
        organizationId: orgIdA,
        userId: adminUserIdA,
        userPermissions: ["*"],
        prompt: "What encryption standards are required for our databases?",
        useKnowledgeBase: true,
      });

      expect(response.status).toBe("COMPLETED");
      expect(response.output).toBeDefined();
      expect(response.citations).toBeDefined();
      expect(response.citations?.length).toBeGreaterThan(0);
      expect(response.citations![0].documentTitle).toBe("SOC 2 Encryption Standards");
    });
  });

  describe("6. AI Tool Execution & Autonomous Workflow Integration", () => {
    it("executes searchKnowledgeBase AI tool successfully", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        name: "Sales Catalog",
        accessPolicy: "PUBLIC",
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        collectionId: col.id,
        title: "Artify Enterprise Tier Pricing",
        buffer: Buffer.from("Enterprise plan starts at $4,999/month with dedicated TAM and 99.99% SLA.", "utf8"),
        mimeType: "text/plain",
      });

      const result = await aiToolExecutor.executeTool(
        "searchKnowledgeBase",
        { query: "Enterprise pricing plan SLA" },
        {
          organizationId: orgIdA,
          userId: adminUserIdA,
          userPermissions: ["knowledge.search"],
          agentName: "Sales Advisor Agent",
        }
      );

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.count).toBeGreaterThan(0);
      expect(data.results[0].documentTitle).toBe("Artify Enterprise Tier Pricing");
      expect(data.results[0].snippet).toContain("Enterprise plan starts at $4,999");
    });

    it("executes KNOWLEDGE_RETRIEVAL step inside autonomous workflow engine", async () => {
      const col = await KnowledgeService.createCollection({
        organizationId: orgIdA,
        name: "Support KB",
        accessPolicy: "PUBLIC",
      });

      await KnowledgeService.ingestDocument({
        organizationId: orgIdA,
        collectionId: col.id,
        title: "Password Reset Guide",
        buffer: Buffer.from("To reset your password, visit auth.artify.com/forgot and check your email.", "utf8"),
        mimeType: "text/plain",
      });

      const workflow = await prisma.automationWorkflow.create({
        data: {
          organizationId: orgIdA,
          createdById: adminUserIdA,
          name: "Support Triage Workflow",
          status: "ACTIVE",
          currentVersion: 1,
          publishedVersion: 1,
          triggerType: "MANUAL",
          triggerConfig: {},
          steps: [
            {
              id: "step_kb",
              name: "Retrieve Solution from Knowledge Base",
              type: "KNOWLEDGE_RETRIEVAL",
              queryTemplate: "password reset instructions",
              outputKey: "kbResult",
            },
          ] as any,
        },
      });

      const enqueueResult = await workflowEngine.enqueueExecution({
        workflowId: workflow.id,
        organizationId: orgIdA,
        initiatedById: adminUserIdA,
        triggerType: "MANUAL",
      });

      const execResult = await workflowEngine.execute(enqueueResult.executionId);
      expect(execResult.status).toBe("COMPLETED");

      const execution = await prisma.automationExecution.findUnique({
        where: { id: enqueueResult.executionId },
      });

      const context = execution?.context as any;
      expect(context.kbResult).toBeDefined();
      expect(context.kbResult.count).toBeGreaterThan(0);
      expect(context.kbResult.results[0].documentTitle).toBe("Password Reset Guide");
    });
  });
});
