/**
 * Contact management (Phase 5 — docs/CRM_ARCHITECTURE.md). Every mutation
 * validates BOTH the target contact's organization ownership AND, where a
 * client is involved, the client's organization ownership — the IDOR
 * pattern §14 calls out explicitly (a contact id and a client id must
 * each independently resolve inside the caller's own tenant).
 */
import { prisma } from "../db/prisma";
import { contactRepository, type ContactFilters } from "../repositories/contactRepository";
import { clientRepository } from "../repositories/clientRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateContactInput, UpdateContactInput } from "../schemas/contactSchemas";
import type { RequestMeta } from "./authService";
import type { Contact } from "@prisma/client";

async function loadContactInOrgOrThrow(id: string, organizationId: string): Promise<Contact> {
  const contact = await contactRepository.findByIdInOrg(id, organizationId);
  if (!contact) throw new NotFoundError("Contact not found.");
  return contact;
}

async function assertClientInOrg(clientId: string, organizationId: string): Promise<void> {
  const client = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
}

export const contactService = {
  async listForOrg(organizationId: string, filters: ContactFilters, page: number, limit: number) {
    if (filters.clientId) await assertClientInOrg(filters.clientId, organizationId);
    return contactRepository.listForOrg(organizationId, filters, page, limit);
  },

  async listForClient(organizationId: string, clientId: string, page: number, limit: number) {
    await assertClientInOrg(clientId, organizationId);
    return contactRepository.listForClient(clientId, organizationId, page, limit);
  },

  async getContact(organizationId: string, id: string): Promise<Contact> {
    return loadContactInOrgOrThrow(id, organizationId);
  },

  async createForClient(caller: SanitizedUser, clientId: string, input: CreateContactInput, meta: RequestMeta = {}): Promise<Contact> {
    await assertClientInOrg(clientId, caller.organizationId);

    const email = input.email || undefined;
    if (email) {
      const dup = await contactRepository.findByEmailForClient(clientId, caller.organizationId, email);
      if (dup) throw new ConflictError("A contact with this email already exists for this client.");
    }

    const contact = await prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.contact.updateMany({ where: { clientId, isPrimary: true, deletedAt: null }, data: { isPrimary: false } });
      }
      return tx.contact.create({
        data: {
          organizationId: caller.organizationId,
          clientId,
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone,
          jobTitle: input.jobTitle,
          isPrimary: input.isPrimary ?? false,
        },
      });
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_CREATED",
      resourceType: "contact",
      resourceId: contact.id,
      afterData: { clientId, firstName: contact.firstName, lastName: contact.lastName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return contact;
  },

  async updateContact(caller: SanitizedUser, id: string, input: UpdateContactInput, meta: RequestMeta = {}): Promise<Contact> {
    const existing = await loadContactInOrgOrThrow(id, caller.organizationId);

    if (input.email) {
      const dup = existing.clientId ? await contactRepository.findByEmailForClient(existing.clientId, caller.organizationId, input.email) : null;
      if (dup && dup.id !== id) throw new ConflictError("A contact with this email already exists for this client.");
    }

    const patch: Record<string, unknown> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.jobTitle !== undefined) patch.jobTitle = input.jobTitle;
    if (input.status !== undefined) patch.status = input.status;

    const updated = await prisma.$transaction(async (tx) => {
      if (input.isPrimary !== undefined) {
        if (input.isPrimary && existing.clientId) {
          await tx.contact.updateMany({
            where: { clientId: existing.clientId, isPrimary: true, deletedAt: null, id: { not: id } },
            data: { isPrimary: false },
          });
        }
        patch.isPrimary = input.isPrimary;
      }
      return tx.contact.update({ where: { id }, data: patch });
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_UPDATED",
      resourceType: "contact",
      resourceId: id,
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteContact(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    await loadContactInOrgOrThrow(id, caller.organizationId);
    await contactRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_DELETED",
      resourceType: "contact",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
