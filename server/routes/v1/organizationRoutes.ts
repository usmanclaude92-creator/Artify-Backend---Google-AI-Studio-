import { Router } from "express";
import { organizationService } from "../../services/organizationService";
import { organizationMembershipRepository } from "../../repositories/organizationMembershipRepository";
import { sessionRepository } from "../../repositories/sessionRepository";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { addMemberSchema, listUsersQuerySchema, updateMemberSchema } from "../../schemas/userSchemas";
import { AuthorizationError } from "../../core/errors";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organizations = await organizationService.listOrganizations(req.user!);
    sendSuccess(res, { organizations });
  })
);

router.get(
  "/:id",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organization = await organizationService.getOrganization(req.user!, req.params.id!);
    sendSuccess(res, { organization });
  })
);

/** Real data only (§20) — memberCount/activeSessionCount are live counts, never estimated. */
router.get(
  "/:id/summary",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user!.role.key !== "SUPER_ADMIN" && req.params.id! !== req.user!.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const [{ total: memberCount }, activeSessionCount] = await Promise.all([
      organizationMembershipRepository.listForOrganization(req.params.id!, 1, 1),
      sessionRepository.countActiveForOrganization(req.params.id!),
    ]);
    sendSuccess(res, { memberCount, activeSessionCount });
  })
);

router.get(
  "/:id/members",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user!.role.key !== "SUPER_ADMIN" && req.params.id! !== req.user!.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const query = listUsersQuerySchema.parse(req.query);
    const { rows, total } = await organizationMembershipRepository.listForOrganization(req.params.id!, query.page, query.limit);
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

router.post(
  "/:id/members",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = addMemberSchema.parse(req.body);
    const membership = await organizationService.addMember(req.user!, req.params.id!, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { membership }, 201);
  })
);

router.patch(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = updateMemberSchema.parse(req.body);
    const membership = await organizationService.updateMember(
      req.user!,
      req.params.id!,
      req.params.userId!,
      input,
      req.user!.role.permissions,
      { ip: req.ip, userAgent: req.headers["user-agent"] }
    );
    sendSuccess(res, { membership });
  })
);

router.delete(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    await organizationService.removeMember(req.user!, req.params.id!, req.params.userId!, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { message: "Membership removed." });
  })
);

export default router;
