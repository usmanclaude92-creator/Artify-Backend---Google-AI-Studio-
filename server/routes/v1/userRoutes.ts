import { Router } from "express";
import { userService } from "../../services/userService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createUserSchema, listUsersQuerySchema, updateUserSchema } from "../../schemas/userSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    // A non-SUPER_ADMIN caller can only ever list their own current
    // session organization — a query-string organizationId is honored
    // only for SUPER_ADMIN (§17: never trust a caller-supplied org id).
    const organizationId =
      req.user!.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user!.organizationId;

    const { users, total } = await userService.listUsers(organizationId, query.page, query.limit);
    sendSuccess(res, { users }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const user = await userService.getUser(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { user });
  })
);

router.post(
  "/",
  requirePermission("users.create"),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(req.user!, input, { ip: req.ip, userAgent: req.headers["user-agent"] });
    sendSuccess(res, { user }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("users.update"),
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(req.user!, req.params.id!, input, req.user!.role.permissions, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, { user });
  })
);

export default router;
