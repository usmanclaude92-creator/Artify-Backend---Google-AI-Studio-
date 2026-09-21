/** Standalone contact endpoints (§14) — GET/PATCH/DELETE by contact id; creation/listing is nested under /clients/:clientId/contacts (clientRoutes.ts). */
import { Router } from "express";
import { contactService } from "../../services/contactService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { updateContactSchema, listAllContactsQuerySchema } from "../../schemas/contactSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

/** Org-wide contact directory (§22's top-level Contacts nav item), optionally filtered to one client. */
router.get(
  "/",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listAllContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForOrg(
      req.user!.organizationId,
      { search: query.search, clientId: query.clientId },
      query.page,
      query.limit
    );
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const contact = await contactService.getContact(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { contact });
  })
);

router.patch(
  "/:id",
  requirePermission("contacts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContactSchema.parse(req.body);
    const contact = await contactService.updateContact(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { contact });
  })
);

router.delete(
  "/:id",
  requirePermission("contacts.delete"),
  asyncHandler(async (req, res) => {
    await contactService.deleteContact(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Contact removed." });
  })
);

export default router;
