import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { ConditionEngine } from "../../server/services/automation/ConditionEngine";
import { eventEngine } from "../../server/services/automation/EventEngine";
import { schedulerEngine } from "../../server/services/automation/SchedulerEngine";
import { automationService } from "../../server/services/automation/AutomationService";

describe("Phase 13 — Autonomous AI Workflows & Business Automation Integration Tests", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let orgId: string;
  let otherOrgToken: string;
  let otherOrgId: string;
  let workflowId: string;
  let executionId: string;
  let approvalId: string;

  beforeAll(async () => {
    await resetDb();

    // Register primary organization & admin
    const reg1 = await request(app).post("/api/v1/auth/register").send({
      email: "automation-admin@artify.test",
      password: "Password123!Secure",
      firstName: "Automation",
      lastName: "Admin",
      organizationName: "Automation Testing Corp",
    });
    adminToken = reg1.body.data.session.token;
    orgId = reg1.body.data.user.organizationId;

    // Register secondary tenant for tenant isolation verification
    const reg2 = await request(app).post("/api/v1/auth/register").send({
      email: "other-auto@artify.test",
      password: "Password123!Secure",
      firstName: "Other",
      lastName: "Tenant",
      organizationName: "Second Automation Corp",
    });
    otherOrgToken = reg2.body.data.session.token;
    otherOrgId = reg2.body.data.user.organizationId;
  });

  afterAll(async () => {
    schedulerEngine.stop();
    await disconnectPrisma();
  });

  // ---------------------------------------------------------------------------
  // 1. Safe Condition Engine Unit Verification
  // ---------------------------------------------------------------------------
  describe("1. Safe Condition Engine", () => {
    it("evaluates comparisons accurately without eval()", () => {
      expect(ConditionEngine.compare(100, ">", 50)).toBe(true);
      expect(ConditionEngine.compare(50, "<=", 50)).toBe(true);
      expect(ConditionEngine.compare("ACTIVE", "=", "ACTIVE")).toBe(true);
      expect(ConditionEngine.compare("INACTIVE", "!=", "ACTIVE")).toBe(true);
      expect(ConditionEngine.compare(["foo", "bar"], "CONTAINS", "bar")).toBe(true);
      expect(ConditionEngine.compare("draft", "IN", ["draft", "published"])).toBe(true);
      expect(ConditionEngine.compare("", "IS_EMPTY", null)).toBe(true);
      expect(ConditionEngine.compare("hello world", "STARTS_WITH", "hello")).toBe(true);
    });

    it("safely evaluates nested condition trees and dot notation paths", () => {
      const context = {
        invoice: {
          amount: 5000,
          currency: "USD",
          client: {
            tier: "ENTERPRISE",
            status: "ACTIVE",
          },
        },
      };

      // AND group
      const andCondition = {
        logic: "AND" as const,
        conditions: [
          { field: "invoice.amount", operator: ">" as const, value: 1000 },
          { field: "invoice.client.tier", operator: "=" as const, value: "ENTERPRISE" },
        ],
      };
      expect(ConditionEngine.evaluate(andCondition, context)).toBe(true);

      // OR group
      const orCondition = {
        logic: "OR" as const,
        conditions: [
          { field: "invoice.amount", operator: "<" as const, value: 100 },
          { field: "invoice.client.status", operator: "=" as const, value: "ACTIVE" },
        ],
      };
      expect(ConditionEngine.evaluate(orCondition, context)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Action Registry
  // ---------------------------------------------------------------------------
  describe("2. Controlled Business Action Registry", () => {
    it("GET /api/v1/automation/actions returns registered actions", async () => {
      const res = await request(app)
        .get("/api/v1/automation/actions")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.actions)).toBe(true);
      const actionIds = res.body.data.actions.map((a: any) => a.id);
      expect(actionIds).toContain("create_task");
      expect(actionIds).toContain("create_notification");
      expect(actionIds).toContain("assign_user");
    });

    it("POST /api/v1/automation/actions/execute executes action directly with validation", async () => {
      const res = await request(app)
        .post("/api/v1/automation/actions/execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          actionId: "create_task",
          input: {
            title: "Direct Test Task",
            description: "Task executed via action registry test",
            priority: "HIGH",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.result.title).toBe("Direct Test Task");
      expect(res.body.data.result.status).toBe("PENDING");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Workflow Authoring & Strict Validation
  // ---------------------------------------------------------------------------
  describe("3. Workflow Authoring & Lifecycle", () => {
    it("POST /api/v1/automation/workflows creates a draft workflow", async () => {
      const res = await request(app)
        .post("/api/v1/automation/workflows")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Client Onboarding Automation",
          description: "Welcomes new clients and generates setup tasks",
          category: "ONBOARDING",
          triggerType: "EVENT",
          triggerConfig: {
            eventType: "client.created",
          },
          steps: [
            {
              id: "step_check_status",
              name: "Check Client Status",
              type: "CONDITION",
              condition: {
                field: "payload.status",
                operator: "=",
                value: "ACTIVE",
              },
            },
            {
              id: "step_create_task",
              name: "Generate Welcome Task",
              type: "BUSINESS_ACTION",
              actionId: "create_task",
              parameters: {
                title: "Welcome Setup for {{payload.clientName}}",
                priority: "HIGH",
              },
            },
            {
              id: "step_approval_gate",
              name: "Manager Approval Gate",
              type: "APPROVAL",
              actionDescription: "Approve kickoff meeting for {{payload.clientName}}",
              requiredRole: "ADMIN",
            },
            {
              id: "step_send_notification",
              name: "Notify Team",
              type: "NOTIFICATION",
              channel: "IN_APP",
              titleTemplate: "New Onboarding Kickoff",
              messageTemplate: "Client {{payload.clientName}} has completed initial review.",
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workflow.id).toBeDefined();
      expect(res.body.data.workflow.status).toBe("DRAFT");
      expect(res.body.data.workflow.currentVersion).toBe(1);
      workflowId = res.body.data.workflow.id;
    });

    it("rejects publishing an invalid workflow", async () => {
      // Create invalid workflow with non-existent action and missing trigger
      const invalidWf = await request(app)
        .post("/api/v1/automation/workflows")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Invalid Wf",
          triggerType: "EVENT",
          triggerConfig: {}, // missing eventType
          steps: [
            {
              id: "bad_step",
              name: "Bad Step",
              type: "BUSINESS_ACTION",
              actionId: "non_existent_action_xyz",
              parameters: {},
            },
          ],
        });

      const pubRes = await request(app)
        .post(`/api/v1/automation/workflows/${invalidWf.body.data.workflow.id}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(pubRes.status).toBe(400);
      expect(pubRes.body.success).toBe(false);
    });

    it("POST /api/v1/automation/workflows/:id/publish successfully publishes valid workflow", async () => {
      const res = await request(app)
        .post(`/api/v1/automation/workflows/${workflowId}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          changeSummary: "Initial v1 release of onboarding workflow",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workflow.status).toBe("ACTIVE");
      expect(res.body.data.workflow.publishedVersion).toBe(1);
    });

    it("GET /api/v1/automation/workflows/:id/versions retrieves immutable versions", async () => {
      const res = await request(app)
        .get(`/api/v1/automation/workflows/${workflowId}/versions`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.versions.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.versions[0].version).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Execution, Human Approval Gate & Resumption
  // ---------------------------------------------------------------------------
  describe("4. Execution Engine & Approval Gate", () => {
    it("triggers manual execution and pauses at approval step", async () => {
      const triggerRes = await request(app)
        .post(`/api/v1/automation/workflows/${workflowId}/trigger`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          input: {
            status: "ACTIVE",
            clientName: "Acme Studios Inc",
          },
        });

      expect(triggerRes.status).toBe(202);
      expect(triggerRes.body.success).toBe(true);
      executionId = triggerRes.body.data.executionId;

      // Allow async engine step execution to advance
      await new Promise((resolve) => setTimeout(resolve, 300));

      const execRes = await request(app)
        .get(`/api/v1/automation/executions/${executionId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(execRes.status).toBe(200);
      expect(execRes.body.success).toBe(true);
      expect(execRes.body.data.execution.status).toBe("WAITING_APPROVAL");

      // Verify that step 1 (CONDITION) and step 2 (BUSINESS_ACTION create_task) completed
      const steps = execRes.body.data.execution.stepExecutions;
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0].status).toBe("COMPLETED");
      expect(steps[1].status).toBe("COMPLETED");

      // Verify task was created in database
      const tasksRes = await request(app)
        .get("/api/v1/automation/tasks")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.data.rows.length).toBeGreaterThanOrEqual(1);
    });

    it("lists pending approval and approves to resume workflow to completion", async () => {
      const appRes = await request(app)
        .get("/api/v1/automation/approvals?status=PENDING")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(appRes.status).toBe(200);
      expect(appRes.body.data.rows.length).toBeGreaterThanOrEqual(1);
      approvalId = appRes.body.data.rows[0].id;

      // Decide approval -> APPROVED
      const decideRes = await request(app)
        .post(`/api/v1/automation/approvals/${approvalId}/decide`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          decision: "APPROVED",
          reason: "Kickoff meeting scope validated and approved by Admin",
        });

      expect(decideRes.status).toBe(200);
      expect(decideRes.body.success).toBe(true);
      expect(decideRes.body.data.approval.status).toBe("APPROVED");

      // Wait for engine to resume and complete final steps
      await new Promise((resolve) => setTimeout(resolve, 300));

      const execRes = await request(app)
        .get(`/api/v1/automation/executions/${executionId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(execRes.body.data.execution.status).toBe("COMPLETED");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Event Engine Integration
  // ---------------------------------------------------------------------------
  describe("5. Centralized Event Engine", () => {
    it("lists registered event types", async () => {
      const res = await request(app)
        .get("/api/v1/automation/events/types")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const types = res.body.data.types.map((t: any) => t.eventType);
      expect(types).toContain("client.created");
      expect(types).toContain("invoice.overdue");
    });

    it("emits an event and persists it with correlation ID", async () => {
      const res = await request(app)
        .post("/api/v1/automation/events")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          eventType: "client.created",
          entityType: "client",
          entityId: "client_test_999",
          payload: {
            clientName: "Event Driven Client LLC",
            status: "ACTIVE",
          },
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.correlationId).toBeDefined();

      // Verify event history in GET /events
      const listRes = await request(app)
        .get("/api/v1/automation/events")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Scheduler Engine
  // ---------------------------------------------------------------------------
  describe("6. Database-Backed Scheduler", () => {
    let scheduleId: string;

    it("creates a recurring schedule and calculates nextRunAt", async () => {
      const res = await request(app)
        .post("/api/v1/automation/schedules")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          workflowId,
          name: "Hourly Client Health Check",
          description: "Runs recurring health check routine",
          scheduleType: "RECURRING",
          intervalSeconds: 3600,
          timezone: "UTC",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.schedule.isActive).toBe(true);
      expect(res.body.data.schedule.nextRunAt).toBeDefined();
      scheduleId = res.body.data.schedule.id;
    });

    it("toggles schedule active state", async () => {
      const toggleRes = await request(app)
        .patch(`/api/v1/automation/schedules/${scheduleId}/toggle`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.data.schedule.isActive).toBe(false);
    });

    it("deletes a schedule", async () => {
      const delRes = await request(app)
        .delete(`/api/v1/automation/schedules/${scheduleId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.deleted).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Dashboard Metrics & Tenant Isolation
  // ---------------------------------------------------------------------------
  describe("7. Dashboard Metrics & Strict Tenant Isolation", () => {
    it("GET /api/v1/automation/dashboard returns aggregated metrics", async () => {
      const res = await request(app)
        .get("/api/v1/automation/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics.totalWorkflows).toBeGreaterThanOrEqual(1);
      expect(res.body.data.metrics.totalExecutions).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.data.metrics.successRate).toBe("number");
    });

    it("enforces tenant isolation across workflows and executions", async () => {
      // Attempt to access primary org's workflow with other org's token
      const res = await request(app)
        .get(`/api/v1/automation/workflows/${workflowId}`)
        .set("Authorization", `Bearer ${otherOrgToken}`);

      expect(res.status).toBe(404);
    });
  });
});
