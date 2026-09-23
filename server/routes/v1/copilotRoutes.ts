/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 15: AI Copilot & Conversational Workspace Express Routes
 */
import { Router, Request, Response } from "express";
import { CopilotService } from "../../services/copilot/CopilotService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { ValidationError } from "../../core/errors";
import { logger } from "../../core/logger";

const router = Router();

// All copilot endpoints require authenticated tenant session
router.use(authenticateToken);

/**
 * GET /api/v1/copilot/workspaces
 * List workspaces accessible to current user based on RBAC permissions.
 */
router.get("/workspaces", async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const permissions = req.user!.role.permissions || [];

    const workspaces = await CopilotService.listWorkspaces(orgId, permissions);
    res.json({ success: true, data: workspaces });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] GET /workspaces failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/workspaces
 * Create a custom workspace (requires copilot.manage).
 */
router.post("/workspaces", requirePermission("copilot.manage"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    if (!req.body.name || !req.body.name.trim()) {
      throw new ValidationError("Workspace name is required.");
    }

    const workspace = await CopilotService.createWorkspace(orgId, userId, req.body);
    res.status(201).json({ success: true, data: workspace });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /workspaces failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/copilot/workspaces/:id
 */
router.get("/workspaces/:id", async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const permissions = req.user!.role.permissions || [];
    const workspace = await CopilotService.getWorkspace(req.params.id, orgId, permissions);
    res.json({ success: true, data: workspace });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/copilot/conversations
 * List user's conversations with optional filters (workspaceId, status, search).
 */
router.get("/conversations", requirePermission("copilot.read"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const result = await CopilotService.listConversations(orgId, userId, {
      workspaceId: req.query.workspaceId ? String(req.query.workspaceId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 20,
      offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
    });

    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] GET /conversations failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/conversations
 * Create a new conversation.
 */
router.post("/conversations", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const conversation = await CopilotService.createConversation(orgId, userId, req.body);
    res.status(201).json({ success: true, data: conversation });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /conversations failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/copilot/conversations/:id
 * Retrieve conversation details with recent messages and active action previews.
 */
router.get("/conversations/:id", requirePermission("copilot.read"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const conversation = await CopilotService.getConversation(req.params.id, orgId, userId);
    res.json({ success: true, data: conversation });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/conversations/:id/archive
 */
router.post("/conversations/:id/archive", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const updated = await CopilotService.archiveConversation(req.params.id, orgId, userId);
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/v1/copilot/conversations/:id
 */
router.delete("/conversations/:id", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;

    const result = await CopilotService.deleteConversation(req.params.id, orgId, userId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/messages
 * Send a message turn in a conversation.
 */
router.post("/messages", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const permissions = req.user!.role.permissions || [];

    if (!req.body.content || !req.body.content.trim()) {
      throw new ValidationError("Message content is required.");
    }

    const result = await CopilotService.sendMessage(
      {
        organizationId: orgId,
        userId,
        userPermissions: permissions,
        displayName: req.user!.email?.split("@")[0] || "User",
      },
      {
        conversationId: req.body.conversationId,
        workspaceId: req.body.workspaceId,
        content: req.body.content,
        mode: req.body.mode,
        contextMetadata: req.body.contextMetadata,
      }
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /messages failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/messages/stream
 * Stream Copilot conversation turn via Server-Sent Events (SSE).
 */
router.post("/messages/stream", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const permissions = req.user!.role.permissions || [];

    if (!req.body.content || !req.body.content.trim()) {
      throw new ValidationError("Message content is required.");
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent("start", { status: "PROCESSING" });

    const result = await CopilotService.sendMessage(
      {
        organizationId: orgId,
        userId,
        userPermissions: permissions,
        displayName: req.user!.email?.split("@")[0] || "User",
      },
      {
        conversationId: req.body.conversationId,
        workspaceId: req.body.workspaceId,
        content: req.body.content,
        mode: req.body.mode,
        contextMetadata: req.body.contextMetadata,
      }
    );

    if (result.citations && result.citations.length > 0) {
      sendEvent("citations", result.citations);
    }

    if (result.toolResults && result.toolResults.length > 0) {
      sendEvent("tool_calls", result.toolResults);
    }

    if (result.actionPreview) {
      sendEvent("action_preview", result.actionPreview);
    }

    // Stream text chunks
    const fullText = result.assistantMessage.content;
    const words = fullText.split(" ");
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
      sendEvent("chunk", { text: chunk });
    }

    sendEvent("done", {
      conversationId: result.conversationId,
      messageId: result.assistantMessage.id,
      correlationId: result.correlationId,
    });

    res.end();
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /messages/stream failed");
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/v1/copilot/actions/:id/confirm
 * Confirm and execute a pending consequential action preview.
 */
router.post("/actions/:id/confirm", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const permissions = req.user!.role.permissions || [];

    const result = await CopilotService.confirmAction(req.params.id, {
      organizationId: orgId,
      userId,
      userPermissions: permissions,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /actions/:id/confirm failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/copilot/actions/:id/reject
 * Reject a pending consequential action preview.
 */
router.post("/actions/:id/reject", requirePermission("copilot.use"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const userId = req.user!.id;
    const permissions = req.user!.role.permissions || [];

    const result = await CopilotService.rejectAction(req.params.id, {
      organizationId: orgId,
      userId,
      userPermissions: permissions,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] POST /actions/:id/reject failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/copilot/dashboard
 * Return live metrics and usage statistics for Copilot dashboard.
 */
router.get("/dashboard", requirePermission("copilot.read"), async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const stats = await CopilotService.getDashboardStats(orgId);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error({ error }, "[CopilotRoutes] GET /dashboard failed");
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

export default router;
