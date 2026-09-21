/**
 * Public website lead intake (Phase 11 §8 — docs/PUBLIC_API_ARCHITECTURE.md).
 * The only way an anonymous visitor can write anything to the platform.
 * Creates a real CRM Lead under the single configured
 * `PUBLIC_WEBSITE_ORGANIZATION_ID` — never a caller-supplied organization,
 * owner, or lifecycle status. Validation happens entirely server-side
 * (`createPublicLeadSchema`); this service only normalizes and persists.
 */
import { leadRepository } from "../repositories/leadRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { config } from "../config/env";
import { InfrastructureError } from "../core/errors";
import type { CreatePublicLeadInput } from "../schemas/publicSchemas";
import type { RequestMeta } from "./authService";
import type { Lead } from "@prisma/client";

function buildNotes(input: CreatePublicLeadInput): string {
  const lines: string[] = [];
  if (input.subject) lines.push(`Subject: ${input.subject}`);
  if (input.productInterest) lines.push(`Product/service interest: ${input.productInterest}`);
  lines.push("", input.message.trim(), "", `Consent to be contacted: given (${input.source}).`);
  return lines.join("\n");
}

export const publicLeadService = {
  /**
   * A non-empty `website` field (the honeypot — §8) means the caller is
   * almost certainly a bot: real visitors never see or fill it (hidden via
   * CSS). Returns `null` in that case — accepted-but-discarded, exactly
   * like a real submission from the caller's point of view, so a bot
   * learns nothing about which field gave it away.
   */
  async createLead(input: CreatePublicLeadInput, meta: RequestMeta = {}): Promise<Lead | null> {
    if (input.website) {
      return null;
    }

    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) {
      throw new InfrastructureError("Public lead intake is not configured.");
    }

    const lead = await leadRepository.create({
      organizationId,
      companyName: input.company || input.name,
      contactName: input.name,
      email: input.email,
      phone: input.phone,
      source: `website:${input.source}`,
      notes: buildNotes(input),
    });

    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      actorName: "Public Website",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, source: lead.source },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return lead;
  },
};
