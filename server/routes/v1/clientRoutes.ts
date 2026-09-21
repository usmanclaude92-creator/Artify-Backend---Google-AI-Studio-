import { Router } from "express";
import { clientService } from "../../services/clientService";
import { contactService } from "../../services/contactService";
import { onboardingService } from "../../services/onboardingService";
import { workspaceService } from "../../services/workspaceService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { createClientSchema, listClientsQuerySchema, updateClientSchema } from "../../schemas/clientSchemas";
import { createContactSchema, listContactsQuerySchema } from "../../schemas/contactSchemas";
import { provisionWorkspaceSchema } from "../../schemas/workspaceSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.get(
  "/",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const query = listClientsQuerySchema.parse(req.query);
    const { rows, total } = await clientService.listClients(
      req.user!.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { clients: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const client = await clientService.getClient(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { client });
  })
);

router.post(
  "/",
  requirePermission("clients.create"),
  asyncHandler(async (req, res) => {
    const input = createClientSchema.parse(req.body);
    const client = await clientService.createClient(req.user!, input, requestMeta(req));
    sendSuccess(res, { client }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("clients.update"),
  asyncHandler(async (req, res) => {
    const input = updateClientSchema.parse(req.body);
    const client = await clientService.updateClient(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { client });
  })
);

router.delete(
  "/:id",
  requirePermission("clients.delete"),
  asyncHandler(async (req, res) => {
    await clientService.deleteClient(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Client archived." });
  })
);

// Nested contacts (§14) — every request still validates the client's own
// organization ownership inside contactService, not just the client id
// shape.
router.get(
  "/:clientId/contacts",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForClient(req.user!.organizationId, req.params.clientId!, query.page, query.limit);
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.post(
  "/:clientId/contacts",
  requirePermission("contacts.create"),
  asyncHandler(async (req, res) => {
    const input = createContactSchema.parse(req.body);
    const contact = await contactService.createForClient(req.user!, req.params.clientId!, input, requestMeta(req));
    sendSuccess(res, { contact }, 201);
  })
);

// Onboarding + workspace provisioning (Phase 6 — nested under the owning
// CRM client, same convention as /contacts above).
router.post(
  "/:clientId/onboarding/start",
  requirePermission("onboarding.create"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.startOnboarding(req.user!, req.params.clientId!, requestMeta(req));
    sendSuccess(res, { onboarding: record }, 201);
  })
);

router.get(
  "/:clientId/onboarding",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboardingForClient(req.user!.organizationId, req.params.clientId!);
    sendSuccess(res, { onboarding: record });
  })
);

router.post(
  "/:clientId/workspace/provision",
  requirePermission("workspaces.create"),
  asyncHandler(async (req, res) => {
    const input = provisionWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.provisionWorkspace(req.user!, req.params.clientId!, input, requestMeta(req));
    sendSuccess(res, { workspace }, 201);
  })
);

export default router;
