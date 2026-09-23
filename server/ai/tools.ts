/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Controlled AI tool-execution framework (architectural boundary only —
 * Phase 1 §21 explicitly forbids building AI business workflows yet).
 * Ported from the Phase 0 audit's artifysolscom/server/ai/tools.ts design
 * (docs/ADR/ADR-007-ai-governance.md — this was the best-designed
 * subsystem found in the audit and is REUSEd, not rebuilt).
 *
 * The governing rule this module exists to enforce: an AI coworker can
 * NEVER execute arbitrary SQL, shell commands, filesystem access, or
 * unrestricted network requests. Every action it can take must be a
 * registered `AiToolDefinition` with an explicit required permission,
 * validated input, and an audit-log write on every execution attempt
 * (success or failure). No tools are registered yet — Phase 12 adds the
 * first real ones (searchArticles, createDraft, etc., mirroring the
 * Phase 0 prototype's registry) once the services they call exist.
 */
import type { PermissionKey } from "../types/domain";
import type { InvoiceStatus, ClientStatus } from "@prisma/client";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { logger } from "../core/logger";

export interface AiToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface AiToolDefinition {
  name: string;
  displayName: string;
  description: string;
  requiredPermission: PermissionKey;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requiresApproval?: boolean;
  requiresAudit?: boolean;
  parameters: AiToolParameterSchema;
  handler: (args: Record<string, unknown>, context: AiToolExecutionContext) => Promise<unknown>;
}

export interface AiToolExecutionContext {
  organizationId: string;
  userId?: string;
  userPermissions?: readonly string[];
  agentId?: string;
  agentName: string;
  taskId?: string;
  requestId?: string;
}

export interface AiToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresApproval?: boolean;
  approvalPayload?: unknown;
  approvalId?: string;
}

import { prisma } from "../db/prisma";
import { clientRepository } from "../repositories/clientRepository";
import { productRepository } from "../repositories/productRepository";
import { postRepository } from "../repositories/postRepository";
import { invoiceRepository } from "../repositories/invoiceRepository";
import { aiRepository } from "../repositories/aiRepository";

export const AI_TOOL_REGISTRY: Record<string, AiToolDefinition> = {
  readClients: {
    name: "readClients",
    displayName: "Read CRM Clients",
    description: "Query active clients by name, code, or email.",
    requiredPermission: "clients.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term to match client name or code" },
      },
    },
    handler: async (args, context) => {
      const { rows } = await clientRepository.list(
        context.organizationId,
        { search: String(args.query || "") },
        1,
        20,
        "createdAt",
        "desc"
      );
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        clientCode: c.clientCode,
        status: c.status,
        email: c.email,
      }));
    },
  },

  modifyClientStatus: {
    name: "modifyClientStatus",
    displayName: "Modify Client Status",
    description: "Update client status. High-risk operation requiring approval.",
    requiredPermission: "clients.update",
    riskLevel: "HIGH",
    requiresApproval: true,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Client ID to modify" },
        newStatus: { type: "string", description: "New client status" },
      },
      required: ["clientId", "newStatus"],
    },
    handler: async (args, context) => {
      const clientId = String(args.clientId);
      const newStatus = String(args.newStatus);
      const client = await clientRepository.findByIdInOrg(clientId, context.organizationId);
      if (!client) {
        throw new Error(`Client "${clientId}" not found in organization.`);
      }
      const updated = await clientRepository.update(clientId, {
        status: newStatus as ClientStatus,
      });
      return { success: true, client: updated };
    },
  },

  searchClients: {
    name: "searchClients",
    displayName: "Search CRM Clients",
    description: "Search active clients by name, code, or email.",
    requiredPermission: "clients.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term to match client name or code" },
      },
      required: ["query"],
    },
    handler: async (args, context) => {
      const { rows } = await clientRepository.list(
        context.organizationId,
        { search: String(args.query || "") },
        1,
        10,
        "createdAt",
        "desc"
      );
      return rows.map((c) => ({
        id: c.id,
        name: c.name,
        clientCode: c.clientCode,
        status: c.status,
        email: c.email,
      }));
    },
  },

  searchUsers: {
    name: "searchUsers",
    displayName: "Search Team Members",
    description: "Search internal team members by name or email.",
    requiredPermission: "users.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or email search query" },
      },
      required: ["query"],
    },
    handler: async (args, context) => {
      const query = String(args.query || "").trim();
      const users = await prisma.user.findMany({
        where: {
          organizationId: context.organizationId,
          ...(query
            ? {
                OR: [
                  { email: { contains: query, mode: "insensitive" } },
                  { firstName: { contains: query, mode: "insensitive" } },
                  { lastName: { contains: query, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        take: 10,
      });
      return users.map((u) => ({
        id: u.id,
        displayName: u.displayName || `${u.firstName} ${u.lastName}`,
        email: u.email,
        status: u.status,
        title: u.title,
      }));
    },
  },

  searchProducts: {
    name: "searchProducts",
    displayName: "Search Product Catalog",
    description: "Query active products by title or code.",
    requiredPermission: "products.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name or code" },
      },
    },
    handler: async (args) => {
      const { rows } = await productRepository.list(
        { search: String(args.query || "") },
        1,
        10,
        "name",
        "asc"
      );
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        type: p.type,
        shortDescription: p.shortDescription,
      }));
    },
  },

  readCmsContent: {
    name: "readCmsContent",
    displayName: "Read CMS Content",
    description: "Search blog posts and editorial content.",
    requiredPermission: "content.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword search in title or content" },
      },
    },
    handler: async (args, context) => {
      const { rows } = await postRepository.list(
        context.organizationId,
        { search: String(args.query || "") },
        1,
        10,
        "createdAt",
        "desc"
      );
      return rows.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        publishedAt: p.publishedAt,
      }));
    },
  },

  readInvoices: {
    name: "readInvoices",
    displayName: "Read Invoices",
    description: "Query commercial invoices for balance, status, and due dates.",
    requiredPermission: "invoices.read",
    riskLevel: "MEDIUM",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        clientId: { type: "string", description: "Optional client ID filter" },
        status: { type: "string", description: "Invoice status filter (DRAFT, ISSUED, PAID, VOID)" },
      },
    },
    handler: async (args, context) => {
      const { rows } = await invoiceRepository.list(
        context.organizationId,
        {
          clientId: args.clientId ? String(args.clientId) : undefined,
          status: args.status ? (String(args.status) as InvoiceStatus) : undefined,
        },
        1,
        10,
        "issueDate",
        "desc"
      );
      return rows.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        total: inv.total,
        currency: inv.currency,
        dueDate: inv.dueDate,
      }));
    },
  },

  generateReportSummary: {
    name: "generateReportSummary",
    displayName: "Generate Metric Report Summary",
    description: "Aggregate high-level CRM and commercial statistics for reporting.",
    requiredPermission: "reports.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {},
    },
    handler: async (_args, context) => {
      const [clientsCount, leadsCount, productsCount, invoicesCount] = await Promise.all([
        prisma.client.count({ where: { organizationId: context.organizationId, deletedAt: null } }),
        prisma.lead.count({ where: { organizationId: context.organizationId, deletedAt: null } }),
        prisma.product.count({}),
        prisma.invoice.count({ where: { organizationId: context.organizationId } }),
      ]);
      return {
        totalClients: clientsCount,
        totalLeads: leadsCount,
        totalProducts: productsCount,
        totalInvoices: invoicesCount,
        reportDate: new Date().toISOString(),
      };
    },
  },

  createDraftPost: {
    name: "createDraftPost",
    displayName: "Create Draft CMS Post",
    description: "Propose an unpublished blog post draft. Requires editorial approval.",
    requiredPermission: "content.create",
    riskLevel: "MEDIUM",
    requiresApproval: true,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Post title" },
        content: { type: "string", description: "Post content" },
        excerpt: { type: "string", description: "Short post summary" },
      },
      required: ["title", "content"],
    },
    handler: async (args, context) => {
      // If executed without approval gate, returns proposal
      return {
        action: "PROPOSAL_CREATED",
        title: args.title,
        status: "DRAFT",
        author: context.agentName,
      };
    },
  },

  // Phase 14: Enterprise Knowledge & RAG Tools
  searchKnowledgeBase: {
    name: "searchKnowledgeBase",
    displayName: "Search Enterprise Knowledge Base",
    description: "Search authorized company documents, policies, wikis, and structured records with semantic and hybrid retrieval.",
    requiredPermission: "knowledge.search",
    riskLevel: "LOW",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or natural language question" },
        mode: { type: "string", description: "Search mode: SEMANTIC, KEYWORD, or HYBRID", enum: ["SEMANTIC", "KEYWORD", "HYBRID"] },
        limit: { type: "string", description: "Maximum number of chunks to return (default 5)" },
      },
      required: ["query"],
    },
    handler: async (args, context) => {
      const { KnowledgeService } = await import("../services/knowledge/KnowledgeService");
      const query = String(args.query || "");
      const limit = args.limit ? parseInt(String(args.limit), 10) : 5;
      const mode = (args.mode as "SEMANTIC" | "KEYWORD" | "HYBRID") || "HYBRID";

      const results = await KnowledgeService.search(
        { query, limit, mode },
        {
          organizationId: context.organizationId,
          userId: context.userId,
          userPermissions: (context.userPermissions as string[]) || [],
        }
      );

      return {
        query,
        count: results.length,
        results: results.map((r) => ({
          documentTitle: r.documentTitle,
          collection: r.collectionName,
          page: r.pageNumber,
          section: r.sectionHeading,
          similarityScore: r.score,
          snippet: r.content.slice(0, 400),
        })),
      };
    },
  },

  getKnowledgeDocumentDetails: {
    name: "getKnowledgeDocumentDetails",
    displayName: "Get Knowledge Document Details",
    description: "Retrieve metadata, active version, and chunk count of an authorized knowledge document.",
    requiredPermission: "knowledge.read",
    riskLevel: "LOW",
    parameters: {
      type: "object",
      properties: {
        documentId: { type: "string", description: "Unique ID of the document" },
      },
      required: ["documentId"],
    },
    handler: async (args, context) => {
      const doc = await prisma.knowledgeDocument.findFirst({
        where: { id: String(args.documentId), organizationId: context.organizationId },
        include: { collection: true, versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!doc) {
        throw new Error(`Document ${args.documentId} not found or inaccessible.`);
      }
      return {
        id: doc.id,
        title: doc.title,
        status: doc.status,
        collection: doc.collection?.name,
        activeVersion: doc.activeVersion,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        totalChunks: doc.versions[0]?.totalChunks || 0,
      };
    },
  },

  // Phase 15: AI Copilot & Conversational Workspace Tools
  createTask: {
    name: "createTask",
    displayName: "Create Task",
    description: "Create an authorized organizational task for a team member, with due date, priority, and optional entity linkage.",
    requiredPermission: "automation.create",
    riskLevel: "MEDIUM",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title or objective" },
        description: { type: "string", description: "Detailed task instructions or notes" },
        assigneeUserId: { type: "string", description: "User ID to assign the task to" },
        assignedRole: { type: "string", description: "Optional role name for the task assignment" },
        priority: { type: "string", description: "Task priority: LOW, MEDIUM, HIGH, URGENT", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        dueDate: { type: "string", description: "ISO date string for task deadline" },
        entityType: { type: "string", description: "Associated entity type (e.g. CLIENT, INVOICE, LEAD, DOCUMENT)" },
        entityId: { type: "string", description: "Associated entity unique ID" },
      },
      required: ["title"],
    },
    handler: async (args, context) => {
      const title = String(args.title).trim();
      if (!title) throw new Error("Task title is required.");

      let assigneeUserId = args.assigneeUserId ? String(args.assigneeUserId) : undefined;
      if (assigneeUserId) {
        const user = await prisma.user.findFirst({
          where: { id: assigneeUserId, organizationId: context.organizationId },
        });
        if (!user) {
          throw new Error(`Assignee user "${assigneeUserId}" not found in this organization.`);
        }
      }

      const priority = (args.priority as any) || "MEDIUM";
      const dueDate = args.dueDate ? new Date(String(args.dueDate)) : null;

      const task = await prisma.automationTask.create({
        data: {
          organizationId: context.organizationId,
          title,
          description: args.description ? String(args.description) : null,
          assignedUserId: assigneeUserId || null,
          assignedRole: args.assignedRole ? String(args.assignedRole) : null,
          priority,
          status: "PENDING",
          dueDate,
          sourceEntityType: args.entityType ? String(args.entityType) : null,
          sourceEntityId: args.entityId ? String(args.entityId) : null,
          isAiGenerated: true,
          metadata: {
            createdVia: "AI_COPILOT",
            agentName: context.agentName,
            createdAt: new Date().toISOString(),
          },
        },
      });

      return {
        success: true,
        taskId: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        assignedUserId: task.assignedUserId,
      };
    },
  },

  searchTasks: {
    name: "searchTasks",
    displayName: "Search Tasks",
    description: "Search and list organization tasks by status, priority, or assignee.",
    requiredPermission: "automation.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: PENDING, IN_PROGRESS, COMPLETED, CANCELLED" },
        priority: { type: "string", description: "Filter by priority: LOW, MEDIUM, HIGH, URGENT" },
        assigneeUserId: { type: "string", description: "Filter by assigned user ID" },
        query: { type: "string", description: "Keyword search in title or description" },
        limit: { type: "string", description: "Maximum tasks to return (default 10)" },
      },
    },
    handler: async (args, context) => {
      const take = args.limit ? parseInt(String(args.limit), 10) : 10;
      const tasks = await prisma.automationTask.findMany({
        where: {
          organizationId: context.organizationId,
          ...(args.status ? { status: args.status as any } : {}),
          ...(args.priority ? { priority: args.priority as any } : {}),
          ...(args.assigneeUserId ? { assignedUserId: String(args.assigneeUserId) } : {}),
        },
        orderBy: { createdAt: "desc" },
        take,
      });

      return tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        assignedUserId: t.assignedUserId,
        isAiGenerated: t.isAiGenerated,
      }));
    },
  },

  executeWorkflow: {
    name: "executeWorkflow",
    displayName: "Trigger Autonomous Workflow",
    description: "Trigger an approved business automation workflow by workflow ID.",
    requiredPermission: "automation.execute",
    riskLevel: "HIGH",
    requiresApproval: true,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "ID of the published automation workflow" },
        triggerPayload: { type: "string", description: "Optional JSON payload string to seed workflow context" },
      },
      required: ["workflowId"],
    },
    handler: async (args, context) => {
      const { workflowEngine } = await import("../services/automation/WorkflowEngine");
      let parsedPayload: Record<string, unknown> = {};
      if (args.triggerPayload) {
        try {
          parsedPayload = typeof args.triggerPayload === "string" ? JSON.parse(args.triggerPayload) : (args.triggerPayload as any);
        } catch {
          parsedPayload = { raw: args.triggerPayload };
        }
      }

      const enqueueResult = await workflowEngine.enqueueExecution({
        workflowId: String(args.workflowId),
        organizationId: context.organizationId,
        initiatedById: context.userId,
        triggerType: "MANUAL",
        triggerPayload: parsedPayload,
      });

      return {
        success: true,
        executionId: enqueueResult.executionId,
        status: enqueueResult.status,
      };
    },
  },

  getWorkflowStatus: {
    name: "getWorkflowStatus",
    displayName: "Get Workflow Status",
    description: "Check current progress, status, and step executions of a workflow execution run.",
    requiredPermission: "automation.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        executionId: { type: "string", description: "Unique execution run ID" },
      },
      required: ["executionId"],
    },
    handler: async (args, context) => {
      const execution = await prisma.automationExecution.findFirst({
        where: { id: String(args.executionId), organizationId: context.organizationId },
        include: {
          workflow: true,
          stepExecutions: { orderBy: { stepIndex: "asc" } },
        },
      });

      if (!execution) {
        throw new Error(`Execution "${args.executionId}" not found in this organization.`);
      }

      return {
        id: execution.id,
        workflowName: execution.workflow?.name,
        status: execution.status,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        durationMs: execution.durationMs,
        steps: execution.stepExecutions.map((s) => ({
          stepName: s.stepName,
          status: s.status,
          stepType: s.stepType,
        })),
      };
    },
  },

  generateNaturalLanguageReport: {
    name: "generateNaturalLanguageReport",
    displayName: "Generate Controlled Business Report",
    description: "Execute a controlled aggregation or query across allowlisted entities (CLIENTS, LEADS, INVOICES, PAYMENTS, CONTRACTS, PRODUCTS, TASKS) without arbitrary SQL.",
    requiredPermission: "reports.read",
    riskLevel: "LOW",
    requiresApproval: false,
    requiresAudit: true,
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Allowlisted entity: CLIENTS, LEADS, INVOICES, PAYMENTS, CONTRACTS, PRODUCTS, TASKS",
          enum: ["CLIENTS", "LEADS", "INVOICES", "PAYMENTS", "CONTRACTS", "PRODUCTS", "TASKS"],
        },
        metric: {
          type: "string",
          description: "Aggregation metric: COUNT, SUM, BREAKDOWN_BY_STATUS, LIST_OVERDUE, LIST_RECENT",
          enum: ["COUNT", "SUM", "BREAKDOWN_BY_STATUS", "LIST_OVERDUE", "LIST_RECENT"],
        },
        statusFilter: { type: "string", description: "Optional status filter" },
      },
      required: ["entity", "metric"],
    },
    handler: async (args, context) => {
      const entity = String(args.entity).toUpperCase();
      const metric = String(args.metric).toUpperCase();
      const orgId = context.organizationId;

      switch (entity) {
        case "CLIENTS": {
          if (metric === "COUNT") {
            const count = await prisma.client.count({ where: { organizationId: orgId, deletedAt: null } });
            return { entity, metric, count, generatedAt: new Date().toISOString() };
          }
          if (metric === "BREAKDOWN_BY_STATUS") {
            const rows = await prisma.client.findMany({
              where: { organizationId: orgId, deletedAt: null },
              select: { status: true },
            });
            const breakdown: Record<string, number> = {};
            for (const r of rows) {
              breakdown[r.status] = (breakdown[r.status] || 0) + 1;
            }
            return { entity, metric, breakdown, total: rows.length };
          }
          const recent = await prisma.client.findMany({
            where: { organizationId: orgId, deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, name: true, clientCode: true, status: true, createdAt: true },
          });
          return { entity, metric: "LIST_RECENT", clients: recent };
        }

        case "INVOICES": {
          if (metric === "COUNT") {
            const count = await prisma.invoice.count({
              where: {
                organizationId: orgId,
                ...(args.statusFilter ? { status: args.statusFilter as any } : {}),
              },
            });
            return { entity, metric, count };
          }
          if (metric === "SUM") {
            const rows = await prisma.invoice.findMany({
              where: {
                organizationId: orgId,
                ...(args.statusFilter ? { status: args.statusFilter as any } : {}),
              },
              select: { total: true, currency: true },
            });
            const totalSum = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
            return { entity, metric, totalSum, count: rows.length };
          }
          if (metric === "LIST_OVERDUE") {
            const now = new Date();
            const overdue = await prisma.invoice.findMany({
              where: {
                organizationId: orgId,
                status: "ISSUED",
                dueDate: { lt: now },
              },
              take: 10,
              select: { id: true, invoiceNumber: true, total: true, dueDate: true, status: true },
            });
            return { entity, metric, overdueInvoices: overdue, count: overdue.length };
          }
          const rows = await prisma.invoice.findMany({
            where: { organizationId: orgId },
            select: { status: true },
          });
          const breakdown: Record<string, number> = {};
          for (const r of rows) {
            breakdown[r.status] = (breakdown[r.status] || 0) + 1;
          }
          return { entity, metric: "BREAKDOWN_BY_STATUS", breakdown, total: rows.length };
        }

        case "LEADS": {
          const count = await prisma.lead.count({ where: { organizationId: orgId, deletedAt: null } });
          const rows = await prisma.lead.findMany({
            where: { organizationId: orgId, deletedAt: null },
            select: { status: true },
          });
          const breakdown: Record<string, number> = {};
          for (const r of rows) {
            breakdown[r.status] = (breakdown[r.status] || 0) + 1;
          }
          return { entity, count, breakdown };
        }

        case "TASKS": {
          const tasks = await prisma.automationTask.findMany({
            where: { organizationId: orgId },
            select: { status: true, priority: true },
          });
          const statusCount: Record<string, number> = {};
          const priorityCount: Record<string, number> = {};
          for (const t of tasks) {
            statusCount[t.status] = (statusCount[t.status] || 0) + 1;
            priorityCount[t.priority] = (priorityCount[t.priority] || 0) + 1;
          }
          return { entity, totalTasks: tasks.length, statusBreakdown: statusCount, priorityBreakdown: priorityCount };
        }

        case "PRODUCTS": {
          const count = await prisma.product.count({});
          return { entity, totalProducts: count };
        }

        default:
          throw new Error(`Entity "${entity}" is not allowlisted for reporting.`);
      }
    },
  },
};

export class AiToolExecutor {
  /**
   * Executes a registered tool by name. Always writes an audit log entry
   * (success or failure) before returning. Checks permissions and handles approval requirements.
   */
  public async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: AiToolExecutionContext
  ): Promise<AiToolExecutionResult> {
    const definition = AI_TOOL_REGISTRY[toolName];

    await auditLogRepository.record({
      organizationId: context.organizationId,
      actorName: context.agentName,
      actorType: "AI_COWORKER",
      action: "AI_TOOL_EXECUTION_ATTEMPT",
      resourceType: "ai_tool",
      resourceId: toolName,
      metadata: { agentId: context.agentId, taskId: context.taskId, found: !!definition },
      requestId: context.requestId,
    });

    if (!definition) {
      logger.warn({ event: "ai_tool_not_registered", toolName }, "AI attempted to call an unregistered tool");
      return { success: false, error: `Tool "${toolName}" is not registered.` };
    }

    // Permission enforcement: if user context is provided, verify required permission
    if (context.userPermissions && !context.userPermissions.includes(definition.requiredPermission)) {
      logger.warn(
        { event: "ai_tool_permission_denied", toolName, required: definition.requiredPermission },
        "AI tool execution blocked by permission check"
      );
      return {
        success: false,
        error: `Permission "${definition.requiredPermission}" required to execute tool "${toolName}".`,
      };
    }

    // Approval gate: if tool requires human approval or is high/critical risk
    if (definition.requiresApproval || definition.riskLevel === "HIGH" || definition.riskLevel === "CRITICAL") {
      const approval = await aiRepository.createApproval({
        organizationId: context.organizationId,
        agentId: context.agentId ?? null,
        executionId: null,
        requesterId: context.userId ?? "system",
        action: `TOOL_EXECUTION:${toolName}`,
        payload: {
          toolName,
          args,
          requiredPermission: definition.requiredPermission,
        },
        status: "PENDING",
        requestedAt: new Date(),
      });

      return {
        success: true,
        requiresApproval: true,
        approvalId: approval.id,
        approvalPayload: {
          toolName,
          args,
          requiredPermission: definition.requiredPermission,
        },
      };
    }

    try {
      const data = await definition.handler(args, context);
      return { success: true, data };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Tool execution failed.";
      logger.error({ err, toolName, event: "ai_tool_execution_failed" }, "Tool execution threw error");
      return { success: false, error: errorMsg };
    }
  }
}

export const aiToolExecutor = new AiToolExecutor();

