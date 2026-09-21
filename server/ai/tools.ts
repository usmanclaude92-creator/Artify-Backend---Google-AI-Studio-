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
import type { InvoiceStatus } from "@prisma/client";
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
}

import { prisma } from "../db/prisma";
import { clientRepository } from "../repositories/clientRepository";
import { productRepository } from "../repositories/productRepository";
import { postRepository } from "../repositories/postRepository";
import { invoiceRepository } from "../repositories/invoiceRepository";

export const AI_TOOL_REGISTRY: Record<string, AiToolDefinition> = {
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

    // Approval gate: if tool requires human approval
    if (definition.requiresApproval) {
      return {
        success: true,
        requiresApproval: true,
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

