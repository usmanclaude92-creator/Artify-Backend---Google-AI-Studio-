import { z } from "zod";

/**
 * Minimal lead-webhook payload shape (foundation only — full CRM
 * processing/auto-triage business logic is Phase 5, see
 * docs/IMPLEMENTATION_PLAN.md). This schema exists so Phase 1 can prove
 * the signature-verification pipeline end to end against a realistic body.
 */
export const leadWebhookPayloadSchema = z.object({
  deliveryId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(100).default("lead.created"),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  companyName: z.string().min(1).max(200),
  projectBrief: z.string().min(1).max(5000),
  source: z.string().max(100).optional(),
});
export type LeadWebhookPayload = z.infer<typeof leadWebhookPayloadSchema>;
