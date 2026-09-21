/** Read-only role/permission catalog (Phase 3 §15/§23) — mutation of the catalog itself (custom roles) is not built in Phase 3, see docs/RBAC_IMPLEMENTATION.md. */
import { Router } from "express";
import { prisma } from "../../db/prisma";
import { roleRepository } from "../../repositories/roleRepository";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const roles = await roleRepository.listAllResolved();
    sendSuccess(res, { roles });
  })
);

export default router;

export const permissionsRouter = Router();
permissionsRouter.use(authenticateToken);
permissionsRouter.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] });
    sendSuccess(res, { permissions });
  })
);
