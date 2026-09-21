import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("Phase 12 — AI Control Center Integration Tests", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let otherOrgToken: string;
  let otherOrgId: string;
  let providerId: string;
  let modelId: string;
  let promptId: string;
  let agentId: string;

  beforeAll(async () => {
    await resetDb();

    // Register primary test organization & admin
    const reg1 = await request(app).post("/api/v1/auth/register").send({
      email: "ai-admin@artify.test",
      password: "Password123!Secure",
      firstName: "AI",
      lastName: "Admin",
      organizationName: "AI Testing Corp",
    });
    adminToken = reg1.body.data.session.token;
    orgId = reg1.body.data.user.organizationId;

    // Register second tenant to test tenant isolation
    const reg2 = await request(app).post("/api/v1/auth/register").send({
      email: "ai-other@artify.test",
      password: "Password123!Secure",
      firstName: "Other",
      lastName: "Tenant",
      organizationName: "Second AI Corp",
    });
    otherOrgToken = reg2.body.data.session.token;
    otherOrgId = reg2.body.data.user.organizationId;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("Authentication & RBAC Enforcement", () => {
    it("rejects unauthenticated requests to AI endpoints", async () => {
      const res = await request(app).get("/api/v1/ai/providers");
      expect(res.status).toBe(401);
    });
  });

  describe("Provider & Model Management", () => {
    it("registers a new AI provider and masks sensitive credentials", async () => {
      const res = await request(app)
        .post("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Mock Fast Engine",
          providerType: "MOCK",
          apiKey: "secret-api-key-12345-very-long",
          organizationId: orgId,
          status: "ACTIVE",
          priority: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.provider.id).toBeTruthy();
      providerId = res.body.data.provider.id;
      // Sensitive credential must never be returned in plaintext
      expect(res.body.data.provider.apiKey).toBe("••••••••");
      expect(res.body.data.provider.encryptedKey).toBeUndefined();
    });

    it("registers a model under the provider", async () => {
      const res = await request(app)
        .post("/api/v1/ai/models")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          providerId,
          name: "Mock Mini Flash",
          modelKey: "mock-mini-flash",
          type: "CHAT",
          contextWindow: 128000,
          maxTokens: 4096,
          costPer1kInputTokens: 0.0001,
          costPer1kOutputTokens: 0.0004,
          status: "ACTIVE",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.model.id).toBeTruthy();
      modelId = res.body.data.model.id;
    });

    it("lists providers with registered models", async () => {
      const res = await request(app)
        .get("/api/v1/ai/providers")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.providers.length).toBeGreaterThan(0);
      const found = res.body.data.providers.find((p: { id: string }) => p.id === providerId);
      expect(found).toBeDefined();
      expect(found.models.length).toBeGreaterThan(0);
    });

    it("pings provider for connection health", async () => {
      const res = await request(app)
        .post(`/api/v1/ai/providers/${providerId}/ping`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("HEALTHY");
      expect(typeof res.body.data.latencyMs).toBe("number");
    });
  });

  describe("Prompt Template Management & Versioning", () => {
    it("creates a prompt template with automatic v1 version snapshot", async () => {
      const res = await request(app)
        .post("/api/v1/ai/prompts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Welcome Onboarding Copy",
          code: "welcome_copy",
          template: "Hello {{clientName}}, welcome to {{serviceName}}!",
          systemPrompt: "You are an executive welcome assistant.",
          variables: ["clientName", "serviceName"],
          status: "ACTIVE",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.prompt.id).toBeTruthy();
      expect(res.body.data.prompt.version).toBe(1);
      promptId = res.body.data.prompt.id;
    });

    it("updates prompt template and creates an immutable v2 version record", async () => {
      const res = await request(app)
        .patch(`/api/v1/ai/prompts/${promptId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          template: "Greetings {{clientName}}! Welcome to the premium {{serviceName}}.",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.prompt.version).toBe(2);

      const versionsRes = await request(app)
        .get(`/api/v1/ai/prompts/${promptId}/versions`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(versionsRes.status).toBe(200);
      expect(versionsRes.body.data.versions.length).toBe(2);
    });
  });

  describe("Agent Lifecycle & Versioning", () => {
    it("creates an AI agent with tool permissions and v1 snapshot", async () => {
      const res = await request(app)
        .post("/api/v1/ai/agents")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "CRM Support Copilot",
          code: "crm_copilot",
          description: "Assists with client inquiries and CRM status checks",
          modelId,
          systemInstructions: "You are an internal CRM specialist.",
          allowedTools: ["readClients", "readInvoices"],
          allowedCapabilities: ["CRM_AUTOMATION", "QUERY_DATA"],
          status: "ACTIVE",
          requiresApproval: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.agent.id).toBeTruthy();
      expect(res.body.data.agent.version).toBe(1);
      agentId = res.body.data.agent.id;
    });

    it("lists active agents for tenant", async () => {
      const res = await request(app)
        .get("/api/v1/ai/agents")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.agents.some((a: { id: string }) => a.id === agentId)).toBe(true);
    });
  });

  describe("Unified Orchestrator & Execution Pipeline", () => {
    it("executes a prompt with variable interpolation and creates audit log", async () => {
      const res = await request(app)
        .post("/api/v1/ai/prompts/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          promptId,
          modelId,
          variables: {
            clientName: "Acme Corp",
            serviceName: "Enterprise Cloud Suite",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.output).toBeTruthy();
      expect(res.body.data.output).toContain("Acme Corp");
      expect(res.body.data.output).toContain("Enterprise Cloud Suite");
      expect(res.body.data.executionId).toBeTruthy();
      expect(res.body.data.tokenUsage).toBeDefined();
    });

    it("executes prompt via sandbox endpoint", async () => {
      const res = await request(app)
        .post("/api/v1/ai/sandbox/test")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          modelId,
          prompt: "Summarize this test input safely.",
          temperature: 0.2,
          maxTokens: 256,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.output).toBeTruthy();
      expect(res.body.data.status).toBe("COMPLETED");
    });
  });

  describe("Tool Execution & Risk Evaluation", () => {
    it("lists available tools with risk levels and permission requirements", async () => {
      const res = await request(app)
        .get("/api/v1/ai/tools")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.tools.length).toBeGreaterThan(0);
      const readClientsTool = res.body.data.tools.find((t: { name: string }) => t.name === "readClients");
      expect(readClientsTool).toBeDefined();
      expect(readClientsTool.riskLevel).toBe("LOW");
    });

    it("executes low-risk tool directly when authorized", async () => {
      const res = await request(app)
        .post("/api/v1/ai/tools/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          toolName: "readClients",
          args: { query: "" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.result.success).toBe(true);
      expect(Array.isArray(res.body.data.result.data)).toBe(true);
    });

    it("routes high-risk tool execution to approval queue", async () => {
      const res = await request(app)
        .post("/api/v1/ai/tools/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          toolName: "modifyClientStatus",
          args: { clientId: "dummy-client-id", newStatus: "SUSPENDED" },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.result.requiresApproval).toBe(true);
      expect(res.body.data.result.approvalId).toBeTruthy();
    });
  });

  describe("Human-in-the-Loop Approvals", () => {
    let approvalId: string;

    it("creates an approval request", async () => {
      const createRes = await request(app)
        .post("/api/v1/ai/tools/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          toolName: "modifyClientStatus",
          args: { clientId: "another-dummy-id", newStatus: "INACTIVE" },
        });

      approvalId = createRes.body.data.result.approvalId;
      expect(approvalId).toBeTruthy();
    });

    it("lists pending approvals", async () => {
      const res = await request(app)
        .get("/api/v1/ai/approvals?status=PENDING")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.approvals.some((a: { id: string }) => a.id === approvalId)).toBe(true);
    });

    it("allows authorized manager to reject approval with reason", async () => {
      const res = await request(app)
        .post(`/api/v1/ai/approvals/${approvalId}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          decision: "REJECTED",
          reason: "Risk assessment indicates potential client disruption",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.approval.status).toBe("REJECTED");
    });
  });

  describe("Multi-Tenant Isolation", () => {
    it("prevents tenant B from viewing tenant A's agents", async () => {
      const res = await request(app)
        .get(`/api/v1/ai/agents/${agentId}`)
        .set("Authorization", `Bearer ${otherOrgToken}`);

      expect(res.status).toBe(404);
    });

    it("prevents tenant B from listing tenant A's execution logs", async () => {
      const res = await request(app)
        .get("/api/v1/ai/executions")
        .set("Authorization", `Bearer ${otherOrgToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.executions.every((e: { organizationId: string }) => e.organizationId === otherOrgId)).toBe(true);
    });
  });

  describe("Telemetry, Analytics & Diagnostics", () => {
    it("returns comprehensive AI telemetry summary", async () => {
      const res = await request(app)
        .get("/api/v1/ai/analytics/summary")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toBeDefined();
      expect(typeof res.body.data.summary.totalExecutions).toBe("number");
      expect(typeof res.body.data.summary.totalTokens).toBe("number");
      expect(typeof res.body.data.summary.estimatedCostUsd).toBe("number");
      expect(typeof res.body.data.summary.successRatePercent).toBe("number");
    });

    it("returns diagnostics report with provider health and safety checks", async () => {
      const res = await request(app)
        .get("/api/v1/ai/diagnostics")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.systemStatus).toBe("HEALTHY");
      expect(Array.isArray(res.body.data.providers)).toBe(true);
      expect(Array.isArray(res.body.data.safetyChecks)).toBe(true);
    });
  });
});
