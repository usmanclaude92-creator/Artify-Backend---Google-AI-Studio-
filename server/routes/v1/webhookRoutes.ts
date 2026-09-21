import { Router } from "express";
import { webhookService, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../../services/webhookService";
import { webhookLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { leadWebhookPayloadSchema } from "../../schemas/webhookSchemas";

const router = Router();

router.post(
  "/leads",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const payload = leadWebhookPayloadSchema.parse(req.body);

    const result = await webhookService.ingestLeadEvent(payload, {
      rawBody: req.rawBody,
      signatureHeader: req.headers[SIGNATURE_HEADER],
      timestampHeader: req.headers[TIMESTAMP_HEADER],
    });

    // Duplicates still return 200 (per webhook convention — the sender's
    // delivery succeeded, it's just already recorded), distinguished only
    // in the response body for observability.
    sendSuccess(res, { accepted: true, duplicate: result.duplicate });
  })
);

export default router;
