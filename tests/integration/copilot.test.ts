/**
 * Phase 15 — AI Copilot & Conversational Workspace Integration Tests
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { CopilotService } from "../../server/services/copilot/CopilotService";

describe("Phase 15 — AI Copilot & Conversational Workspace Integration Tests", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let adminUserId: string;

  let otherOrgToken: string;
  let otherOrgId: string;
  let otherUserId: string;

  let workspaceId: string;
  let conversationId: string;
  let testClientId: string;

  beforeAll(async () => {
    await resetDb();

    // Register primary tenant admin
    const reg1 = await request(app).post("/api/v1/auth/register").send({
      email: "copilot-admin@artify.test",
      password: "Password123!Secure",
      firstName: "Copilot",
      lastName: "Admin",
      organizationName: "Copilot Enterprise Corp",
    });
    adminToken = reg1.body.data.session.token;
    orgId = reg1.body.data.user.organizationId;
    adminUserId = reg1.body.data.user.id;

    // Register secondary tenant for isolation tests
    const reg2 = await request(app).post("/api/v1/auth/register").send({
      email: "other-tenant@artify.test",
      password: "Password123!Secure",
      firstName: "Other",
      lastName: "User",
      organizationName: "Isolate Corp",
    });
    otherOrgToken = reg2.body.data.session.token;
    otherOrgId = reg2.body.data.user.organizationId;
    otherUserId = reg2.body.data.user.id;

    // Create a test client in primary org for context and action testing
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        name: "Acme Global Dynamics",
        clientCode: "ACME-100",
        status: "ACTIVE",
        tier: "ENTERPRISE",
      },
    });
    testClientId = client.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  // ---------------------------------------------------------------------------
  // 1. Workspace Discovery & Management
  // ---------------------------------------------------------------------------
  describe("1. Workspace Discovery & Governance", () => {
    it("auto-seeds system workspaces on first discovery and returns them", async () => {
      const res = await request(app)
        .get("/api/v1/copilot/workspaces")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);

      const generalWs = res.body.data.find((w: any) => w.slug === "general-assistant");
      expect(generalWs).toBeDefined();
      expect(generalWs.name).toBe("General Enterprise Assistant");
      expect(generalWs.isSystem).toBe(true);
      expect(generalWs.allowedTools).toContain("searchKnowledgeBase");

      workspaceId = generalWs.id;
    });

    it("allows authorized users to fetch a specific workspace by ID", async () => {
      const res = await request(app)
        .get(`/api/v1/copilot/workspaces/${workspaceId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(workspaceId);
    });

    it("allows manager to create a custom workspace", async () => {
      const res = await request(app)
        .post("/api/v1/copilot/workspaces")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Legal & Regulatory Compliance Assistant",
          description: "Specialized assistant for terms and GDPR policies.",
          systemInstruction: "You are a legal advisor assistant.",
          allowedTools: ["searchKnowledgeBase", "createTask"],
          requiredPermissions: ["copilot.use"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slug).toBe("legal-regulatory-compliance-assistant");
      expect(res.body.data.isSystem).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Conversation Lifecycle & Isolation
  // ---------------------------------------------------------------------------
  describe("2. Conversation Lifecycle & Multi-Tenant Isolation", () => {
    it("creates a new conversation in the selected workspace", async () => {
      const res = await request(app)
        .post("/api/v1/copilot/conversations")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          workspaceId,
          title: "Initial Enterprise Evaluation",
          contextMetadata: { currentModule: "GENERAL" },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Initial Enterprise Evaluation");
      expect(res.body.data.workspaceId).toBe(workspaceId);
      expect(res.body.data.status).toBe("ACTIVE");

      conversationId = res.body.data.id;
    });

    it("lists user conversations with filter and search", async () => {
      const res = await request(app)
        .get("/api/v1/copilot/conversations?status=ACTIVE")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.conversations[0].id).toBe(conversationId);
    });

    it("prevents another tenant from viewing primary tenant's conversation (isolation)", async () => {
      const res = await request(app)
        .get(`/api/v1/copilot/conversations/${conversationId}`)
        .set("Authorization", `Bearer ${otherOrgToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Conversational Messaging, Grounding & Tools
  // ---------------------------------------------------------------------------
  describe("3. Conversational Turn & Context Processing", () => {
    it("processes a user message, produces an assistant response with tokens and correlation ID", async () => {
      const res = await request(app)
        .post("/api/v1/copilot/messages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          conversationId,
          content: "Hello Copilot, summarize what capabilities you provide in this workspace.",
          mode: "SUMMARIZE",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBe(conversationId);
      expect(res.body.data.userMessage).toBeDefined();
      expect(res.body.data.assistantMessage).toBeDefined();
      expect(res.body.data.assistantMessage.role).toBe("assistant");
      expect(res.body.data.assistantMessage.totalTokens).toBeGreaterThan(0);
      expect(res.body.data.correlationId).toMatch(/^copilot-/);
    });

    it("executes safe tool createTask when explicitly requested in prompt", async () => {
      const res = await request(app)
        .post("/api/v1/copilot/messages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          conversationId,
          content: "Please create a task: Review Q3 enterprise security audit",
          mode: "EXECUTE",
          contextMetadata: {
            selectedClientId: testClientId,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assistantMessage).toBeDefined();

      // Check that a task was created in the database
      const createdTask = await prisma.automationTask.findFirst({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
      });
      expect(createdTask).toBeDefined();
      expect(createdTask?.title).toContain("Review Q3 enterprise security audit");
    });

    it("sanitizes untrusted / non-existent entity IDs in context metadata", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { validatedContext } = await CopilotService.validateEntityContext(orgId, {
        selectedClientId: fakeId,
        selectedInvoiceId: fakeId,
      });

      // Invalid IDs should be ignored and stripped
      expect(validatedContext.selectedClient).toBeUndefined();
      expect(validatedContext.selectedInvoice).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Consequential Action Safety & Confirmation Gate
  // ---------------------------------------------------------------------------
  describe("4. Consequential Action Safety Preview & Human Confirmation Gate", () => {
    let actionPreviewId: string;

    it("generates a high-risk CopilotActionPreview without directly executing client status modification", async () => {
      // Find or switch to CRM assistant workspace
      const crmWs = await prisma.copilotWorkspace.findFirst({
        where: { organizationId: orgId, slug: "crm-assistant" },
      });

      const res = await request(app)
        .post("/api/v1/copilot/messages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          workspaceId: crmWs?.id,
          content: `Please change status to suspend client ${testClientId} immediately.`,
          contextMetadata: { selectedClientId: testClientId },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const preview = res.body.data.actionPreview;
      expect(preview).toBeDefined();
      expect(preview.actionType).toBe("MODIFY_CLIENT_STATUS");
      expect(preview.riskLevel).toBe("HIGH");
      expect(preview.status).toBe("PENDING");
      expect(preview.requiresApproval).toBe(true);

      actionPreviewId = preview.id;

      // Verify that the client was NOT modified yet (action is still pending)
      const client = await prisma.client.findUnique({ where: { id: testClientId } });
      expect(client?.status).toBe("ACTIVE");
    });

    it("confirms and executes the action when user explicitly approves it", async () => {
      const res = await request(app)
        .post(`/api/v1/copilot/actions/${actionPreviewId}/confirm`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.preview.status).toBe("EXECUTED");

      // Verify that the client was modified now that the action is confirmed
      const client = await prisma.client.findUnique({ where: { id: testClientId } });
      expect(client?.status).toBe("SUSPENDED");
    });

    it("allows declining/rejecting an action preview without applying changes", async () => {
      const crmWs = await prisma.copilotWorkspace.findFirst({
        where: { organizationId: orgId, slug: "crm-assistant" },
      });

      // Request another status change
      const msgRes = await request(app)
        .post("/api/v1/copilot/messages")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          workspaceId: crmWs?.id,
          content: `Please change status to activate client ${testClientId}`,
          contextMetadata: { selectedClientId: testClientId },
        });

      const previewToReject = msgRes.body.data.actionPreview;
      expect(previewToReject).toBeDefined();

      // Reject the action
      const rejectRes = await request(app)
        .post(`/api/v1/copilot/actions/${previewToReject.id}/reject`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.success).toBe(true);
      expect(rejectRes.body.data.preview.status).toBe("REJECTED");

      // Status remains SUSPENDED
      const client = await prisma.client.findUnique({ where: { id: testClientId } });
      expect(client?.status).toBe("SUSPENDED");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Dashboard Metrics & Telemetry
  // ---------------------------------------------------------------------------
  describe("5. Copilot Telemetry & Dashboard Analytics", () => {
    it("returns real-time dashboard analytics", async () => {
      const res = await request(app)
        .get("/api/v1/copilot/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeConversations).toBeGreaterThanOrEqual(1);
      expect(res.body.data.totalMessages).toBeGreaterThanOrEqual(2);
      expect(res.body.data.totalRequests).toBeGreaterThanOrEqual(1);
      expect(res.body.data.executedActions).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.data.mostUsedWorkspaces)).toBe(true);
    });

    it("verifies audit logs were written for copilot activities", async () => {
      const logs = await prisma.auditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      const actions = logs.map((l) => l.action);
      expect(actions).toContain("COPILOT_MESSAGE_PROCESSED");
      expect(actions).toContain("COPILOT_ACTION_CONFIRMED");
    });
  });
});
