/** Phase 4 Settings foundation — organization-scoped, backed by the Phase 2 system_settings table. Only what the backend genuinely supports; no editable-for-appearance's-sake fields. */
import { Router } from "express";
import { systemSettingRepository } from "../../repositories/systemSettingRepository";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { updateSettingSchema } from "../../schemas/settingsSchemas";

const router = Router();

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("settings.read"),
  asyncHandler(async (req, res) => {
    const settings = await systemSettingRepository.listForOrganization(req.user!.organizationId);
    sendSuccess(res, { settings });
  })
);

router.patch(
  "/:key",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = updateSettingSchema.parse(req.body);
    const setting = await systemSettingRepository.upsert({
      organizationId: req.user!.organizationId,
      key: req.params.key!,
      value: input.value,
      type: input.type,
      description: input.description,
      updatedById: req.user!.id,
    });

    await auditLogRepository.record({
      organizationId: req.user!.organizationId,
      actorUserId: req.user!.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      resourceType: "system_setting",
      resourceId: setting.id,
      afterData: { key: setting.key },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    sendSuccess(res, { setting });
  })
);

export default router;
