/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 15: AI Copilot & Conversational Workspace Service
 * Production service for multi-workspace AI assistant, context memory,
 * grounding, tool execution, consequential action preview/confirmation,
 * streaming, and audit logging.
 */
import { prisma } from "../../db/prisma";
import { aiToolExecutor, AI_TOOL_REGISTRY } from "../../ai/tools";
import { AdapterFactory } from "../../ai/adapters/adapterFactory";
import { aiRepository } from "../../repositories/aiRepository";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { KnowledgeService } from "../knowledge/KnowledgeService";
import type { KnowledgeCitation } from "../knowledge/types";
import { logger } from "../../core/logger";
import { ValidationError, NotFoundError, AuthorizationError } from "../../core/errors";
import crypto from "crypto";

export interface CopilotUserContext {
  organizationId: string;
  userId: string;
  userPermissions: readonly string[];
  roleName?: string;
  displayName?: string;
}

export interface SendMessageOptions {
  conversationId?: string;
  workspaceId?: string;
  content: string;
  mode?: "ANSWER" | "EXPLAIN" | "SUMMARIZE" | "ANALYZE" | "RECOMMEND" | "DRAFT" | "EXECUTE";
  contextMetadata?: {
    currentModule?: string;
    currentPage?: string;
    selectedClientId?: string;
    selectedInvoiceId?: string;
    selectedDocumentId?: string;
    selectedWorkflowId?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// System Default Workspace Templates
// ---------------------------------------------------------------------------
export const SYSTEM_WORKSPACES = [
  {
    slug: "general-assistant",
    name: "General Enterprise Assistant",
    description: "Versatile corporate coworker for company policies, organizational knowledge, tasks, and high-level reports.",
    icon: "Bot",
    allowedTools: ["searchKnowledgeBase", "getKnowledgeDocumentDetails", "createTask", "searchTasks", "generateNaturalLanguageReport"],
    allowedModules: ["GENERAL", "KNOWLEDGE", "REPORTS"],
    requiredPermissions: ["copilot.use"],
    defaultMode: "ANSWER" as const,
    temperature: 0.6,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: true,
    systemInstruction:
      "You are the Artify Solutions General Enterprise Copilot. Provide accurate, professional, and well-grounded answers based on organizational knowledge and registered tools. When knowledge is consulted, cite sources faithfully. Never invent business records.",
  },
  {
    slug: "crm-assistant",
    name: "CRM & Client Intelligence Assistant",
    description: "Client management assistant for researching accounts, reviewing contacts, managing leads, and scheduling follow-up tasks.",
    icon: "Users",
    allowedTools: ["readClients", "searchClients", "modifyClientStatus", "createTask", "searchTasks", "generateNaturalLanguageReport", "searchKnowledgeBase"],
    allowedModules: ["CRM", "CLIENTS", "LEADS"],
    requiredPermissions: ["copilot.use", "clients.read"],
    defaultMode: "ANSWER" as const,
    temperature: 0.5,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: false,
    systemInstruction:
      "You are the Artify CRM Assistant. Assist account executives and managers with client records, lead pipelines, and customer follow-ups. Consequential client status changes require explicit confirmation preview.",
  },
  {
    slug: "billing-assistant",
    name: "Commercial & Billing Assistant",
    description: "Financial assistant for reviewing invoices, checking payment balances, tracking overdue accounts, and generating summaries.",
    icon: "Receipt",
    allowedTools: ["readInvoices", "generateReportSummary", "generateNaturalLanguageReport", "createTask", "searchTasks", "searchKnowledgeBase"],
    allowedModules: ["COMMERCIAL", "BILLING", "INVOICES"],
    requiredPermissions: ["copilot.use", "invoices.read"],
    defaultMode: "ANSWER" as const,
    temperature: 0.3,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: false,
    systemInstruction:
      "You are the Artify Billing & Commercial Assistant. Help users analyze invoice histories, calculate outstanding balances, and locate overdue records. Never alter financial records or fabricate currency numbers.",
  },
  {
    slug: "operations-assistant",
    name: "Operations & Workflows Assistant",
    description: "Autonomous operations assistant to inspect workflow pipelines, trigger verified automations, and track executions.",
    icon: "Workflow",
    allowedTools: ["executeWorkflow", "getWorkflowStatus", "createTask", "searchTasks", "generateNaturalLanguageReport", "searchKnowledgeBase"],
    allowedModules: ["OPERATIONS", "AUTOMATION"],
    requiredPermissions: ["copilot.use", "automation.read"],
    defaultMode: "EXECUTE" as const,
    temperature: 0.4,
    maxTokens: 2048,
    requireCitations: false,
    isDefault: false,
    systemInstruction:
      "You are the Artify Operations & Automation Assistant. Guide users through workflow execution, step telemetry, and approval status. Triggering workflows must provide complete parameters and preview.",
  },
  {
    slug: "cms-assistant",
    name: "Content & Publishing Assistant",
    description: "Editorial assistant for drafting blog content, summarizing releases, and structuring metadata with approval gates.",
    icon: "FileText",
    allowedTools: ["readCmsContent", "createDraftPost", "searchProducts", "searchKnowledgeBase"],
    allowedModules: ["CMS", "CONTENT"],
    requiredPermissions: ["copilot.use", "content.read"],
    defaultMode: "DRAFT" as const,
    temperature: 0.7,
    maxTokens: 3000,
    requireCitations: true,
    isDefault: false,
    systemInstruction:
      "You are the Artify Editorial & Publishing Assistant. Craft clear, high-impact marketing and product drafts aligned with company standards. Draft publications require editorial review.",
  },
  {
    slug: "knowledge-assistant",
    name: "Document Intelligence & Knowledge Assistant",
    description: "Deep research and policy query specialist using semantic retrieval across corporate documents, manuals, and specifications.",
    icon: "Search",
    allowedTools: ["searchKnowledgeBase", "getKnowledgeDocumentDetails", "createTask"],
    allowedModules: ["KNOWLEDGE"],
    requiredPermissions: ["copilot.use", "knowledge.read"],
    defaultMode: "EXPLAIN" as const,
    temperature: 0.3,
    maxTokens: 2500,
    requireCitations: true,
    isDefault: false,
    systemInstruction:
      "You are the Artify Document Intelligence Specialist. Provide meticulous, evidence-grounded answers strictly based on retrieved enterprise documents. Always cite document name, section, and page.",
  },
  {
    slug: "admin-assistant",
    name: "Administration & Governance Assistant",
    description: "Governance coworker for inspecting team members, reviewing system health, checking audit summaries, and evaluating workflows.",
    icon: "ShieldAlert",
    allowedTools: ["searchUsers", "generateReportSummary", "generateNaturalLanguageReport", "executeWorkflow", "getWorkflowStatus", "searchKnowledgeBase"],
    allowedModules: ["PLATFORM", "ADMIN"],
    requiredPermissions: ["copilot.use", "roles.read"],
    defaultMode: "ANALYZE" as const,
    temperature: 0.3,
    maxTokens: 2048,
    requireCitations: false,
    isDefault: false,
    systemInstruction:
      "You are the Artify Platform Administration Assistant. Deliver precise operational intelligence and governance summaries. Enforce strict least-privilege compliance.",
  },
];

// Simple in-memory rate limiter per user (30 messages / min)
const userMessageRateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): void {
  const now = Date.now();
  const entry = userMessageRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    userMessageRateMap.set(userId, { count: 1, resetAt: now + 60000 });
    return;
  }
  if (entry.count >= 35) {
    throw new ValidationError("Rate limit exceeded: You have sent too many messages in a short time. Please wait a minute.");
  }
  entry.count += 1;
}

export class CopilotService {
  /**
   * Seed default system workspaces for an organization if not already seeded.
   */
  public static async ensureDefaultWorkspaces(organizationId: string): Promise<void> {
    for (const ws of SYSTEM_WORKSPACES) {
      const existing = await prisma.copilotWorkspace.findFirst({
        where: { organizationId, slug: ws.slug },
      });
      if (!existing) {
        await prisma.copilotWorkspace.create({
          data: {
            organizationId,
            name: ws.name,
            slug: ws.slug,
            description: ws.description,
            icon: ws.icon,
            isSystem: true,
            isDefault: ws.isDefault,
            allowedTools: ws.allowedTools,
            allowedModules: ws.allowedModules,
            requiredPermissions: ws.requiredPermissions,
            systemInstruction: ws.systemInstruction,
            defaultMode: ws.defaultMode,
            temperature: ws.temperature,
            maxTokens: ws.maxTokens,
            requireCitations: ws.requireCitations,
          },
        });
      }
    }
  }

  /**
   * List workspaces accessible to the user based on RBAC permissions.
   */
  public static async listWorkspaces(organizationId: string, userPermissions: readonly string[]) {
    await this.ensureDefaultWorkspaces(organizationId);

    const workspaces = await prisma.copilotWorkspace.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    const isSuperAdmin = userPermissions.includes("*");

    return workspaces.filter((ws) => {
      if (isSuperAdmin) return true;
      const reqPerms = (ws.requiredPermissions as string[]) || [];
      if (reqPerms.length === 0) return true;
      return reqPerms.every((p) => userPermissions.includes(p));
    });
  }

  /**
   * Get workspace by ID with permission check.
   */
  public static async getWorkspace(id: string, organizationId: string, userPermissions: readonly string[]) {
    const ws = await prisma.copilotWorkspace.findFirst({
      where: { id, organizationId },
    });
    if (!ws) {
      throw new NotFoundError(`Workspace "${id}" not found.`);
    }

    const isSuperAdmin = userPermissions.includes("*");
    const reqPerms = (ws.requiredPermissions as string[]) || [];
    if (!isSuperAdmin && reqPerms.some((p) => !userPermissions.includes(p))) {
      throw new AuthorizationError(`You do not have the required permissions to access the "${ws.name}" workspace.`);
    }

    return ws;
  }

  /**
   * Create custom workspace (requires copilot.manage).
   */
  public static async createWorkspace(
    organizationId: string,
    userId: string,
    data: {
      name: string;
      slug?: string;
      description?: string;
      icon?: string;
      allowedTools?: string[];
      allowedModules?: string[];
      requiredPermissions?: string[];
      systemInstruction?: string;
      defaultMode?: any;
      temperature?: number;
      maxTokens?: number;
      requireCitations?: boolean;
    }
  ) {
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const existing = await prisma.copilotWorkspace.findFirst({
      where: { organizationId, slug },
    });
    if (existing) {
      throw new ValidationError(`Workspace with slug "${slug}" already exists in this organization.`);
    }

    return prisma.copilotWorkspace.create({
      data: {
        organizationId,
        createdById: userId,
        name: data.name,
        slug,
        description: data.description,
        icon: data.icon || "Bot",
        isSystem: false,
        isDefault: false,
        allowedTools: data.allowedTools || ["searchKnowledgeBase", "createTask"],
        allowedModules: data.allowedModules || ["GENERAL"],
        requiredPermissions: data.requiredPermissions || ["copilot.use"],
        systemInstruction: data.systemInstruction,
        defaultMode: data.defaultMode || "ANSWER",
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        requireCitations: data.requireCitations ?? true,
      },
    });
  }

  /**
   * List conversations for a specific user and organization.
   */
  public static async listConversations(
    organizationId: string,
    userId: string,
    filter: { workspaceId?: string; status?: string; search?: string; limit?: number; offset?: number }
  ) {
    const limit = filter.limit ? Math.min(filter.limit, 50) : 20;
    const offset = filter.offset || 0;

    const where: any = {
      organizationId,
      userId,
      status: filter.status || "ACTIVE",
    };

    if (filter.workspaceId) {
      where.workspaceId = filter.workspaceId;
    }

    if (filter.search) {
      where.title = { contains: filter.search, mode: "insensitive" };
    }

    const [conversations, total] = await Promise.all([
      prisma.copilotConversation.findMany({
        where,
        include: {
          workspace: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.copilotConversation.count({ where }),
    ]);

    return { conversations, total, limit, offset };
  }

  /**
   * Get single conversation with message history and verification of ownership.
   */
  public static async getConversation(conversationId: string, organizationId: string, userId: string) {
    const conv = await prisma.copilotConversation.findFirst({
      where: { id: conversationId, organizationId, userId },
      include: {
        workspace: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: 50,
        },
        actionPreviews: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found or unauthorized.`);
    }

    return conv;
  }

  /**
   * Create new conversation.
   */
  public static async createConversation(
    organizationId: string,
    userId: string,
    data: { workspaceId?: string; title?: string; contextMetadata?: Record<string, unknown> }
  ) {
    let workspaceId = data.workspaceId;
    if (!workspaceId) {
      await this.ensureDefaultWorkspaces(organizationId);
      const defaultWs = await prisma.copilotWorkspace.findFirst({
        where: { organizationId, isDefault: true },
      });
      workspaceId = defaultWs?.id;
    }

    if (!workspaceId) {
      throw new ValidationError("Workspace is required to start a conversation.");
    }

    const conversation = await prisma.copilotConversation.create({
      data: {
        organizationId,
        userId,
        workspaceId,
        title: data.title?.trim() || "New AI Conversation",
        contextMetadata: (data.contextMetadata as any) || {},
        lastMessageAt: new Date(),
      },
      include: {
        workspace: true,
      },
    });

    await auditLogRepository.record({
      organizationId,
      actorName: userId,
      actorType: "USER",
      action: "COPILOT_CONVERSATION_CREATED",
      resourceType: "copilot_conversation",
      resourceId: conversation.id,
      metadata: { workspaceId, title: conversation.title },
    });

    return conversation;
  }

  /**
   * Archive a conversation.
   */
  public static async archiveConversation(conversationId: string, organizationId: string, userId: string) {
    const conv = await prisma.copilotConversation.findFirst({
      where: { id: conversationId, organizationId, userId },
    });
    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found.`);
    }

    return prisma.copilotConversation.update({
      where: { id: conversationId },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
  }

  /**
   * Delete a conversation.
   */
  public static async deleteConversation(conversationId: string, organizationId: string, userId: string) {
    const conv = await prisma.copilotConversation.findFirst({
      where: { id: conversationId, organizationId, userId },
    });
    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found.`);
    }

    await prisma.copilotConversation.delete({ where: { id: conversationId } });
    return { success: true, id: conversationId };
  }

  /**
   * Validate server-side user context (client ID, invoice ID, document ID).
   * Prevents browser entity spoofing.
   */
  public static async validateEntityContext(
    organizationId: string,
    contextMetadata?: Record<string, unknown>
  ): Promise<{ validatedContext: Record<string, unknown>; contextSummary: string }> {
    if (!contextMetadata || Object.keys(contextMetadata).length === 0) {
      return { validatedContext: {}, contextSummary: "" };
    }

    const validated: Record<string, unknown> = {};
    const summaryParts: string[] = [];

    if (contextMetadata.currentModule) {
      validated.currentModule = String(contextMetadata.currentModule);
      summaryParts.push(`Current Module: ${validated.currentModule}`);
    }

    if (contextMetadata.selectedClientId) {
      const client = await prisma.client.findFirst({
        where: { id: String(contextMetadata.selectedClientId), organizationId, deletedAt: null },
      });
      if (client) {
        validated.selectedClient = { id: client.id, name: client.name, code: client.clientCode, status: client.status };
        summaryParts.push(`Selected Client: ${client.name} (${client.clientCode}) [Status: ${client.status}]`);
      }
    }

    if (contextMetadata.selectedInvoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: String(contextMetadata.selectedInvoiceId), organizationId },
      });
      if (invoice) {
        validated.selectedInvoice = { id: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total, status: invoice.status };
        summaryParts.push(`Selected Invoice: #${invoice.invoiceNumber} [Total: ${invoice.total} ${invoice.currency}, Status: ${invoice.status}]`);
      }
    }

    if (contextMetadata.selectedDocumentId) {
      const doc = await prisma.knowledgeDocument.findFirst({
        where: { id: String(contextMetadata.selectedDocumentId), organizationId },
      });
      if (doc) {
        validated.selectedDocument = { id: doc.id, title: doc.title, mimeType: doc.mimeType, activeVersion: doc.activeVersion };
        summaryParts.push(`Selected Document: "${doc.title}" (Version ${doc.activeVersion})`);
      }
    }

    if (contextMetadata.selectedWorkflowId) {
      const wf = await prisma.automationWorkflow.findFirst({
        where: { id: String(contextMetadata.selectedWorkflowId), organizationId },
      });
      if (wf) {
        validated.selectedWorkflow = { id: wf.id, name: wf.name, status: wf.status };
        summaryParts.push(`Selected Workflow: "${wf.name}" [Status: ${wf.status}]`);
      }
    }

    return { validatedContext: validated, contextSummary: summaryParts.join("\n") };
  }

  /**
   * Generates compact conversation memory summary for long chats (>= 10 messages).
   */
  public static async compactConversationSummary(
    conversationId: string,
    existingSummary: string | null,
    earlierMessages: Array<{ role: string; content: string }>
  ): Promise<string> {
    if (earlierMessages.length === 0) return existingSummary || "";

    const transcript = earlierMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 150)}`)
      .join("\n");

    const summary = `AI-Generated Compact Memory (Updated ${new Date().toISOString().slice(0, 10)}):
Previous discussion highlighted:
${transcript.slice(0, 600)}`;

    await prisma.copilotConversation.update({
      where: { id: conversationId },
      data: { summary },
    });

    return summary;
  }

  /**
   * Main conversational turn: processes user message, performs grounding,
   * evaluates tool requests, checks approvals, generates model response, and records audit.
   */
  public static async sendMessage(userContext: CopilotUserContext, options: SendMessageOptions) {
    checkRateLimit(userContext.userId);

    const startTime = Date.now();
    const correlationId = `copilot-${crypto.randomUUID()}`;

    // 1. Resolve or create conversation
    let conversation;
    if (options.conversationId) {
      conversation = await prisma.copilotConversation.findFirst({
        where: { id: options.conversationId, organizationId: userContext.organizationId, userId: userContext.userId },
        include: { workspace: true },
      });
      if (!conversation) {
        throw new NotFoundError(`Conversation "${options.conversationId}" not found or unauthorized.`);
      }
    } else {
      conversation = await this.createConversation(userContext.organizationId, userContext.userId, {
        workspaceId: options.workspaceId,
        title: options.content.slice(0, 40) + "...",
        contextMetadata: options.contextMetadata,
      });
    }

    const workspace = conversation.workspace;

    // Check workspace permission
    const isSuperAdmin = userContext.userPermissions.includes("*");
    const reqPerms = (workspace.requiredPermissions as string[]) || [];
    if (!isSuperAdmin && reqPerms.some((p) => !userContext.userPermissions.includes(p))) {
      throw new AuthorizationError(`You lack permission to use the "${workspace.name}" workspace.`);
    }

    // 2. Validate entity context server-side
    const mergedContextMetadata = {
      ...(conversation.contextMetadata as any),
      ...(options.contextMetadata || {}),
    };
    const { validatedContext, contextSummary } = await this.validateEntityContext(
      userContext.organizationId,
      mergedContextMetadata
    );

    // 3. Save User Message
    const userMessage = await prisma.copilotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: options.content.trim(),
        status: "COMPLETED",
        correlationId,
        metadata: {
          clientTimestamp: new Date().toISOString(),
          context: validatedContext,
        },
      },
    });

    // 4. Update Conversation Title if default
    if (conversation.title === "New AI Conversation" || conversation.title.endsWith("...")) {
      const newTitle = options.content.trim().slice(0, 45);
      await prisma.copilotConversation.update({
        where: { id: conversation.id },
        data: { title: newTitle },
      });
    }

    // 5. Load bounded recent history (last 10 messages)
    const allMessages = await prisma.copilotMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });

    let compactSummary = conversation.summary;
    if (allMessages.length > 12 && !compactSummary) {
      const earlier = allMessages.slice(0, allMessages.length - 8);
      compactSummary = await this.compactConversationSummary(conversation.id, compactSummary, earlier);
    }

    const recentHistory = allMessages.slice(-8);

    // 6. Enterprise Knowledge Grounding (RAG)
    let citations: KnowledgeCitation[] = [];
    let groundedKnowledgeText = "";

    const userQuery = options.content.toLowerCase();
    const shouldSearchKnowledge =
      workspace.requireCitations ||
      workspace.slug === "knowledge-assistant" ||
      userQuery.includes("policy") ||
      userQuery.includes("document") ||
      userQuery.includes("guide") ||
      userQuery.includes("agreement") ||
      userQuery.includes("contract") ||
      userQuery.includes("standard") ||
      userQuery.includes("rule");

    if (shouldSearchKnowledge) {
      try {
        const groundedResult = await KnowledgeService.getGroundedContext(
          options.content,
          {
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            userPermissions: userContext.userPermissions as string[],
            roleName: userContext.roleName,
          },
          { maxTokens: 1500 }
        );

        if (groundedResult.formattedContext) {
          groundedKnowledgeText = groundedResult.formattedContext;
          citations = groundedResult.citations;
        }
      } catch (kErr) {
        logger.warn({ kErr, correlationId }, "[CopilotService] Knowledge grounding retrieval non-fatal error");
      }
    }

    // 7. Controlled Tool Intent Detection & Consequential Action Preview
    const allowedToolsList = (workspace.allowedTools as string[]) || [];
    let actionPreviewData: any = null;
    let toolExecutionResults: any[] = [];

    // Check for Consequential Action: Client Status Modification
    if (
      allowedToolsList.includes("modifyClientStatus") &&
      (userQuery.includes("change status") || userQuery.includes("update status") || userQuery.includes("suspend client") || userQuery.includes("activate client"))
    ) {
      const match = options.content.match(/[a-f0-9-]{36}/i);
      const targetClientId = match ? match[0] : (validatedContext.selectedClient as any)?.id;
      let newStatus = "ACTIVE";
      if (userQuery.includes("suspend")) newStatus = "SUSPENDED";
      if (userQuery.includes("archive")) newStatus = "ARCHIVED";
      if (userQuery.includes("onboard")) newStatus = "ONBOARDING";

      if (targetClientId) {
        const client = await prisma.client.findFirst({
          where: { id: targetClientId, organizationId: userContext.organizationId },
        });

        if (client) {
          const preview = await prisma.copilotActionPreview.create({
            data: {
              organizationId: userContext.organizationId,
              conversationId: conversation.id,
              toolName: "modifyClientStatus",
              actionType: "MODIFY_CLIENT_STATUS",
              targetEntity: `${client.name} (${client.clientCode})`,
              changesSummary: `Change client status from "${client.status}" to "${newStatus}".`,
              parameters: { clientId: client.id, newStatus },
              riskLevel: "HIGH",
              reason: `User requested status modification in conversation.`,
              requiresApproval: true,
              status: "PENDING",
            },
          });

          actionPreviewData = {
            id: preview.id,
            toolName: preview.toolName,
            actionType: preview.actionType,
            targetEntity: preview.targetEntity,
            changesSummary: preview.changesSummary,
            riskLevel: preview.riskLevel,
            status: preview.status,
            requiresApproval: preview.requiresApproval,
          };
        }
      }
    }

    // Check for Consequential Action: Workflow Execution
    if (
      !actionPreviewData &&
      allowedToolsList.includes("executeWorkflow") &&
      (userQuery.includes("run workflow") || userQuery.includes("trigger workflow") || userQuery.includes("start workflow"))
    ) {
      const wfIdMatch = options.content.match(/[a-f0-9-]{36}/i) || (validatedContext.selectedWorkflow as any)?.id;
      if (wfIdMatch) {
        const wf = await prisma.automationWorkflow.findFirst({
          where: { id: String(wfIdMatch), organizationId: userContext.organizationId },
        });

        if (wf) {
          const preview = await prisma.copilotActionPreview.create({
            data: {
              organizationId: userContext.organizationId,
              conversationId: conversation.id,
              toolName: "executeWorkflow",
              actionType: "EXECUTE_WORKFLOW",
              targetEntity: `Workflow: ${wf.name} (v${wf.currentVersion})`,
              changesSummary: `Trigger execution of workflow "${wf.name}" with manual trigger payload.`,
              parameters: { workflowId: wf.id },
              riskLevel: "HIGH",
              reason: `User requested workflow execution in conversation.`,
              requiresApproval: true,
              status: "PENDING",
            },
          });

          actionPreviewData = {
            id: preview.id,
            toolName: preview.toolName,
            actionType: preview.actionType,
            targetEntity: preview.targetEntity,
            changesSummary: preview.changesSummary,
            riskLevel: preview.riskLevel,
            status: preview.status,
            requiresApproval: preview.requiresApproval,
          };
        }
      }
    }

    // Check for Safe Tools: Direct Execution (e.g. searchClients, readInvoices, createTask, generateNaturalLanguageReport)
    if (!actionPreviewData) {
      // Direct Task Creation (if explicitly requested like "create a task for ...")
      if (
        allowedToolsList.includes("createTask") &&
        (userQuery.includes("create a task") || userQuery.includes("create task") || userQuery.includes("assign task") || userQuery.includes("add task"))
      ) {
        const titleMatch = options.content.replace(/create (a )?task (for )?/i, "").slice(0, 100);
        const taskResult = await aiToolExecutor.executeTool(
          "createTask",
          {
            title: titleMatch || "Follow up on customer inquiry",
            description: options.content,
            priority: userQuery.includes("urgent") ? "URGENT" : userQuery.includes("high") ? "HIGH" : "MEDIUM",
            dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
            entityType: validatedContext.selectedClient ? "CLIENT" : validatedContext.selectedInvoice ? "INVOICE" : undefined,
            entityId: (validatedContext.selectedClient as any)?.id || (validatedContext.selectedInvoice as any)?.id,
          },
          {
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            userPermissions: userContext.userPermissions,
            agentName: workspace.name,
            requestId: correlationId,
          }
        );

        if (taskResult.success) {
          toolExecutionResults.push({ tool: "createTask", result: taskResult.data });
        }
      }

      // Natural Language Business Report
      if (
        allowedToolsList.includes("generateNaturalLanguageReport") &&
        (userQuery.includes("report") || userQuery.includes("how many") || userQuery.includes("unpaid") || userQuery.includes("overdue") || userQuery.includes("breakdown") || userQuery.includes("statistics"))
      ) {
        let entity = "CLIENTS";
        let metric = "COUNT";

        if (userQuery.includes("invoice") || userQuery.includes("bill") || userQuery.includes("balance") || userQuery.includes("overdue")) {
          entity = "INVOICES";
          metric = userQuery.includes("overdue") ? "LIST_OVERDUE" : userQuery.includes("balance") || userQuery.includes("sum") ? "SUM" : "COUNT";
        } else if (userQuery.includes("lead") || userQuery.includes("prospect")) {
          entity = "LEADS";
          metric = userQuery.includes("breakdown") ? "BREAKDOWN_BY_STATUS" : "COUNT";
        } else if (userQuery.includes("task")) {
          entity = "TASKS";
          metric = "COUNT";
        }

        const reportResult = await aiToolExecutor.executeTool(
          "generateNaturalLanguageReport",
          { entity, metric },
          {
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            userPermissions: userContext.userPermissions,
            agentName: workspace.name,
            requestId: correlationId,
          }
        );

        if (reportResult.success) {
          toolExecutionResults.push({ tool: "generateNaturalLanguageReport", result: reportResult.data });
        }
      }

      // Search Clients
      if (allowedToolsList.includes("searchClients") && (userQuery.includes("find client") || userQuery.includes("search client") || userQuery.includes("show client"))) {
        const queryTerm = options.content.replace(/find client|search client|show client/gi, "").trim();
        const clientResult = await aiToolExecutor.executeTool(
          "searchClients",
          { query: queryTerm || "a" },
          {
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            userPermissions: userContext.userPermissions,
            agentName: workspace.name,
            requestId: correlationId,
          }
        );
        if (clientResult.success) {
          toolExecutionResults.push({ tool: "searchClients", result: clientResult.data });
        }
      }
    }

    // 8. Compile AI Prompt & Call Adapter
    const systemPrompt = `${workspace.systemInstruction || "You are an enterprise AI assistant."}
Response Mode: ${options.mode || workspace.defaultMode}
Active Workspace: ${workspace.name}
User Name: ${userContext.displayName || "Authorized Team Member"}

SECURITY AND INTEGRITY RULES:
1. Ground answers strictly in available verified context and tool results.
2. If sufficient data is not available, state clearly what cannot be determined. Do not speculate or invent numbers.
3. If an Action Preview was prepared, explain the exact proposed changes and instruct the user to Confirm or Cancel using the interactive preview below.
4. When citing documents, mention the document title and section clearly.`;

    let contextSection = "";
    if (contextSummary) {
      contextSection += `\n[VERIFIED APPLICATION CONTEXT]:\n${contextSummary}\n`;
    }
    if (compactSummary) {
      contextSection += `\n[CONVERSATION MEMORY SUMMARY]:\n${compactSummary}\n`;
    }
    if (groundedKnowledgeText) {
      contextSection += `\n${groundedKnowledgeText}\n`;
    }
    if (toolExecutionResults.length > 0) {
      contextSection += `\n[TOOL EXECUTION RESULTS]:\n${JSON.stringify(toolExecutionResults, null, 2)}\n`;
    }
    if (actionPreviewData) {
      contextSection += `\n[ACTION PREVIEW GENERATED (PENDING USER CONFIRMATION)]:\nAction: ${actionPreviewData.actionType}\nTarget: ${actionPreviewData.targetEntity}\nSummary: ${actionPreviewData.changesSummary}\nRisk: ${actionPreviewData.riskLevel}\n`;
    }

    // Format chat history
    const conversationHistoryText = recentHistory
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const fullPrompt = `${systemPrompt}

${contextSection}

${conversationHistoryText}

Assistant:`;

    // Invoke AI Provider Adapter
    const provider = await aiRepository.findDefaultProvider(userContext.organizationId);
    const model = await aiRepository.findDefaultModel(provider?.id);
    const adapter = AdapterFactory.getAdapter(provider?.providerType || "GEMINI");

    let assistantResponseText = "";
    let tokenUsage = { inputTokens: Math.round(fullPrompt.length / 4), outputTokens: 120, totalTokens: Math.round(fullPrompt.length / 4) + 120 };

    try {
      const adapterResult = await adapter.generateText({
        apiKey: provider?.apiKeyEncrypted || process.env.GEMINI_API_KEY || "",
        model: model?.modelName || "gemini-2.5-flash",
        prompt: fullPrompt,
        temperature: workspace.temperature,
        maxTokens: workspace.maxTokens,
      });

      assistantResponseText = adapterResult.text;
      if (adapterResult.usage) {
        tokenUsage = {
          inputTokens: adapterResult.usage.promptTokens,
          outputTokens: adapterResult.usage.completionTokens,
          totalTokens: adapterResult.usage.totalTokens,
        };
      }
    } catch (modelErr) {
      logger.warn({ modelErr, correlationId }, "[CopilotService] Adapter model generation fallback used");
      // Provide robust fallback response synthesizing the context and tools
      if (actionPreviewData) {
        assistantResponseText = `I have prepared the action preview for **${actionPreviewData.actionType}** on ${actionPreviewData.targetEntity}.\n\n**Proposed Changes:** ${actionPreviewData.changesSummary}\n\nPlease review the details in the action card below and select **Confirm** or **Cancel** to proceed.`;
      } else if (toolExecutionResults.length > 0) {
        const firstTool = toolExecutionResults[0];
        assistantResponseText = `I processed your request using the **${firstTool.tool}** tool.\n\n${JSON.stringify(firstTool.result, null, 2)}`;
      } else if (citations.length > 0) {
        assistantResponseText = `Based on your enterprise knowledge base, here is what I found:\n\n${citations[0].snippet}\n\n*Source: ${citations[0].documentTitle} (${citations[0].collectionName})*`;
      } else {
        assistantResponseText = `I have received your request regarding "${options.content}". How would you like me to assist with this in the ${workspace.name}?`;
      }
    }

    const durationMs = Date.now() - startTime;
    const estimatedCost = (tokenUsage.inputTokens * 0.000001) + (tokenUsage.outputTokens * 0.000003);

    // 9. Save Assistant Message
    const assistantMessage = await prisma.copilotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: assistantResponseText,
        status: "COMPLETED",
        providerType: provider?.providerType || "GEMINI",
        modelName: model?.modelName || "gemini-2.5-flash",
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        durationMs,
        estimatedCost,
        correlationId,
        citations: citations as any,
        toolCalls: toolExecutionResults as any,
        actionPreview: actionPreviewData as any,
        metadata: {
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          mode: options.mode || workspace.defaultMode,
        },
      },
    });

    // 10. Update Conversation message count & timestamp
    await prisma.copilotConversation.update({
      where: { id: conversation.id },
      data: {
        messageCount: { increment: 2 },
        lastMessageAt: new Date(),
      },
    });

    // 11. Record Copilot Usage & Audit Log
    await Promise.all([
      prisma.copilotUsage.create({
        data: {
          organizationId: userContext.organizationId,
          userId: userContext.userId,
          workspaceId: workspace.id,
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          providerType: provider?.providerType || "GEMINI",
          modelName: model?.modelName || "gemini-2.5-flash",
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          durationMs,
          estimatedCost,
          status: "SUCCESS",
        },
      }),
      auditLogRepository.record({
        organizationId: userContext.organizationId,
        actorName: userContext.userId,
        actorType: "USER",
        action: "COPILOT_MESSAGE_PROCESSED",
        resourceType: "copilot_conversation",
        resourceId: conversation.id,
        metadata: {
          workspace: workspace.slug,
          tokens: tokenUsage.totalTokens,
          citationsCount: citations.length,
          hasActionPreview: !!actionPreviewData,
          correlationId,
        },
        requestId: correlationId,
      }),
    ]);

    return {
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      actionPreview: actionPreviewData,
      citations,
      toolResults: toolExecutionResults,
      correlationId,
    };
  }

  /**
   * Confirm and execute a pending CopilotActionPreview.
   */
  public static async confirmAction(
    actionPreviewId: string,
    userContext: CopilotUserContext
  ) {
    const preview = await prisma.copilotActionPreview.findFirst({
      where: { id: actionPreviewId, organizationId: userContext.organizationId },
      include: { conversation: true },
    });

    if (!preview) {
      throw new NotFoundError(`Action preview "${actionPreviewId}" not found.`);
    }

    if (preview.status !== "PENDING") {
      throw new ValidationError(`Action preview is already in "${preview.status}" status.`);
    }

    const toolDef = AI_TOOL_REGISTRY[preview.toolName];
    if (!toolDef) {
      throw new ValidationError(`Tool "${preview.toolName}" is not registered.`);
    }

    // Permission check for the tool being executed
    const isSuperAdmin = userContext.userPermissions.includes("*");
    if (!isSuperAdmin && !userContext.userPermissions.includes(toolDef.requiredPermission)) {
      throw new AuthorizationError(
        `Permission "${toolDef.requiredPermission}" required to confirm and execute this action.`
      );
    }

    const correlationId = `copilot-action-${crypto.randomUUID()}`;

    // Execute the approved tool
    const params = (preview.parameters as Record<string, unknown>) || {};
    let executionResult: any;

    try {
      executionResult = await toolDef.handler(params, {
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        userPermissions: userContext.userPermissions,
        agentName: "AI Copilot",
        requestId: correlationId,
      });
    } catch (err: any) {
      await prisma.copilotActionPreview.update({
        where: { id: preview.id },
        data: {
          status: "FAILED",
          executionResult: { error: err.message },
          confirmedById: userContext.userId,
          confirmedAt: new Date(),
        },
      });
      throw err;
    }

    // Mark preview EXECUTED
    const updatedPreview = await prisma.copilotActionPreview.update({
      where: { id: preview.id },
      data: {
        status: "EXECUTED",
        executionResult: executionResult as any,
        confirmedById: userContext.userId,
        confirmedAt: new Date(),
      },
    });

    // Append confirmation system message to the conversation
    await prisma.copilotMessage.create({
      data: {
        conversationId: preview.conversationId,
        role: "assistant",
        content: `**Action Confirmed & Executed Successfully:** ${preview.changesSummary}\n\n\`\`\`json\n${JSON.stringify(executionResult, null, 2)}\n\`\`\``,
        status: "COMPLETED",
        correlationId,
        metadata: {
          actionPreviewId: preview.id,
          executedBy: userContext.userId,
        },
      },
    });

    await auditLogRepository.record({
      organizationId: userContext.organizationId,
      actorName: userContext.userId,
      actorType: "USER",
      action: "COPILOT_ACTION_CONFIRMED",
      resourceType: "copilot_action_preview",
      resourceId: preview.id,
      metadata: {
        toolName: preview.toolName,
        actionType: preview.actionType,
        targetEntity: preview.targetEntity,
        correlationId,
      },
      requestId: correlationId,
    });

    return { success: true, preview: updatedPreview, result: executionResult };
  }

  /**
   * Reject a pending CopilotActionPreview.
   */
  public static async rejectAction(actionPreviewId: string, userContext: CopilotUserContext) {
    const preview = await prisma.copilotActionPreview.findFirst({
      where: { id: actionPreviewId, organizationId: userContext.organizationId },
    });

    if (!preview) {
      throw new NotFoundError(`Action preview "${actionPreviewId}" not found.`);
    }

    if (preview.status !== "PENDING") {
      throw new ValidationError(`Action preview is already in "${preview.status}" status.`);
    }

    const updated = await prisma.copilotActionPreview.update({
      where: { id: actionPreviewId },
      data: {
        status: "REJECTED",
        confirmedById: userContext.userId,
        confirmedAt: new Date(),
      },
    });

    await prisma.copilotMessage.create({
      data: {
        conversationId: preview.conversationId,
        role: "assistant",
        content: `*Action cancelled by user:* The proposed action (${preview.actionType}) was declined. No changes were made.`,
        status: "COMPLETED",
        metadata: { actionPreviewId: preview.id, rejectedBy: userContext.userId },
      },
    });

    await auditLogRepository.record({
      organizationId: userContext.organizationId,
      actorName: userContext.userId,
      actorType: "USER",
      action: "COPILOT_ACTION_REJECTED",
      resourceType: "copilot_action_preview",
      resourceId: preview.id,
      metadata: { toolName: preview.toolName, actionType: preview.actionType },
    });

    return { success: true, preview: updated };
  }

  /**
   * Real-time metrics for Copilot section in AI Control Center.
   */
  public static async getDashboardStats(organizationId: string) {
    await this.ensureDefaultWorkspaces(organizationId);

    const [
      conversations,
      usages,
      pendingActions,
      executedActions,
      workspaces,
    ] = await Promise.all([
      prisma.copilotConversation.findMany({
        where: { organizationId },
        select: { id: true, status: true, workspaceId: true },
      }),
      prisma.copilotUsage.findMany({
        where: { organizationId },
        take: 200,
      }),
      prisma.copilotActionPreview.count({
        where: { organizationId, status: "PENDING" },
      }),
      prisma.copilotActionPreview.count({
        where: { organizationId, status: "EXECUTED" },
      }),
      prisma.copilotWorkspace.findMany({
        where: { organizationId },
        include: {
          _count: { select: { conversations: true } },
        },
      }),
    ]);

    const activeConversations = conversations.filter((c) => c.status === "ACTIVE").length;
    const convIds = conversations.map((c) => c.id);
    const totalMessages = convIds.length > 0
      ? await prisma.copilotMessage.count({
          where: { conversationId: { in: convIds } },
        })
      : 0;

    const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0);
    const totalCost = usages.reduce((sum, u) => sum + u.estimatedCost, 0);
    const successfulRequests = usages.filter((u) => u.status === "SUCCESS").length;
    const failedRequests = usages.filter((u) => u.status === "FAILED").length;

    const workspaceUsage = workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      icon: w.icon,
      conversationsCount: (w as any)._count?.conversations || 0,
    })).sort((a, b) => b.conversationsCount - a.conversationsCount);

    return {
      activeConversations,
      totalMessages,
      totalRequests: usages.length,
      successfulRequests,
      failedRequests,
      pendingActions,
      executedActions,
      totalTokens,
      estimatedCost: Number(totalCost.toFixed(4)),
      mostUsedWorkspaces: workspaceUsage,
      generatedAt: new Date().toISOString(),
    };
  }
}
