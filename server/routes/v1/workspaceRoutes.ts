/** Workspace directory/detail + nested members/invitations (Phase 6 §25/§29) — provisioning is POST /clients/:clientId/workspace/provision (clientRoutes.ts). */
import { Router } from "express";
import { workspaceService } from "../../services/workspaceService";
import { invitationService } from "../../services/invitationService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { listWorkspacesQuerySchema, updateWorkspaceSchema } from "../../schemas/workspaceSchemas";
import { createInvitationSchema, listInvitationsQuerySchema } from "../../schemas/invitationSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.parse(req.query);
    const { rows, total } = await workspaceService.listWorkspaces(
      req.user!.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { workspaces: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const workspace = await workspaceService.getWorkspace(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { workspace });
  })
);

router.patch(
  "/:id",
  requirePermission("workspaces.update"),
  asyncHandler(async (req, res) => {
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.updateWorkspace(req.user!, req.params.id!, input, req.user!.role.permissions, requestMeta(req));
    sendSuccess(res, { workspace });
  })
);

router.get(
  "/:id/members",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.pick({ page: true, limit: true }).parse(req.query);
    const { rows, total } = await workspaceService.listMembers(req.user!, req.params.id!, query.page, query.limit);
    const members = rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName,
      status: m.status,
      isPrimary: m.isPrimary,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt,
    }));
    sendSuccess(res, { members }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id/invitations",
  requirePermission("invitations.read"),
  asyncHandler(async (req, res) => {
    const query = listInvitationsQuerySchema.parse(req.query);
    const { rows, total } = await invitationService.listInvitations(req.user!, req.params.id!, query.page, query.limit);
    sendSuccess(res, { invitations: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.post(
  "/:id/invitations",
  requirePermission("invitations.create"),
  asyncHandler(async (req, res) => {
    const input = createInvitationSchema.parse(req.body);
    const { invitation, devToken } = await invitationService.createInvitation(req.user!, req.params.id!, input, requestMeta(req));
    const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
    sendSuccess(res, { invitation: safeInvitation, devToken }, 201);
  })
);

export default router;
