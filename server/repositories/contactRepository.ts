/** Contact data access (Phase 5 — docs/CRM_ARCHITECTURE.md). */
import type { Contact, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface ContactFilters {
  search?: string;
  clientId?: string;
}

export const contactRepository = {
  /** Org-wide contact list (Phase 5 §22's top-level "Contacts" nav item) — still tenant-scoped, optionally further scoped to one client via `filters.clientId`. */
  async listForOrg(organizationId: string, filters: ContactFilters, page: number, limit: number): Promise<{ rows: Contact[]; total: number }> {
    const where: Prisma.ContactWhereInput = { organizationId, deletedAt: null };
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.search) {
      const term = filters.search;
      where.OR = [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { client: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);
    return { rows, total };
  },

  async listForClient(clientId: string, organizationId: string, page: number, limit: number): Promise<{ rows: Contact[]; total: number }> {
    const where: Prisma.ContactWhereInput = { clientId, organizationId, deletedAt: null };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Contact | null> {
    return prisma.contact.findFirst({ where: { id, organizationId, deletedAt: null } });
  },

  async findByEmailForClient(clientId: string, organizationId: string, email: string): Promise<Contact | null> {
    return prisma.contact.findFirst({
      where: { clientId, organizationId, deletedAt: null, email: { equals: email, mode: "insensitive" } },
    });
  },

  async create(data: {
    organizationId: string;
    clientId?: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    isPrimary?: boolean;
  }): Promise<Contact> {
    return prisma.contact.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        jobTitle: data.jobTitle,
        isPrimary: data.isPrimary ?? false,
      },
    });
  },

  async update(id: string, data: Prisma.ContactUpdateInput): Promise<Contact> {
    return prisma.contact.update({ where: { id }, data });
  },

  /** Unsets isPrimary on every OTHER contact for this client — called before setting a new primary, since the partial unique index (schema.prisma) allows at most one. */
  async clearPrimaryForClient(clientId: string, exceptContactId?: string): Promise<void> {
    await prisma.contact.updateMany({
      where: { clientId, isPrimary: true, deletedAt: null, ...(exceptContactId ? { id: { not: exceptContactId } } : {}) },
      data: { isPrimary: false },
    });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  },
};
