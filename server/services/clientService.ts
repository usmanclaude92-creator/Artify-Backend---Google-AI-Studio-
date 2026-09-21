/** Client management (Phase 5 — docs/CRM_ARCHITECTURE.md). Every method is scoped to the caller's own session organization. */
import { clientRepository, type ClientFilters, type ClientWithWorkspace } from "../repositories/clientRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateClientInput, UpdateClientInput } from "../schemas/clientSchemas";
import type { RequestMeta } from "./authService";
import type { Client, Organization } from "@prisma/client";

async function loadClientInOrgOrThrow(id: string, organizationId: string): Promise<ClientWithWorkspace> {
  const client = await clientRepository.findByIdInOrg(id, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

/**
 * Phase 6 §32 — a computed, backend-derived provisioning indicator, never
 * inferred client-side. Workspace status and onboarding status are
 * deliberately independent (§7); this reflects only workspace status.
 * ARCHIVED (deactivated) collapses into SUSPENDED for this 4-value display
 * indicator — both mean "not currently usable."
 */
export type ProvisioningStatus = "NOT_PROVISIONED" | "PROVISIONING" | "PROVISIONED" | "SUSPENDED";

export function computeProvisioningStatus(workspace: Pick<Organization, "status"> | null | undefined): ProvisioningStatus {
  if (!workspace) return "NOT_PROVISIONED";
  if (workspace.status === "ACTIVE") return "PROVISIONED";
  if (workspace.status === "TRIAL") return "PROVISIONING";
  return "SUSPENDED"; // SUSPENDED or ARCHIVED
}

function withProvisioningStatus<T extends { workspaceOrganization?: Organization | null }>(client: T) {
  return { ...client, provisioningStatus: computeProvisioningStatus(client.workspaceOrganization) };
}

export const clientService = {
  async listClients(organizationId: string, filters: ClientFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const { rows, total } = await clientRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withProvisioningStatus), total };
  },

  async getClient(organizationId: string, id: string) {
    const client = await loadClientInOrgOrThrow(id, organizationId);
    return withProvisioningStatus(client);
  },

  async createClient(caller: SanitizedUser, input: CreateClientInput, meta: RequestMeta = {}): Promise<Client> {
    const [byCode, byName] = await Promise.all([
      clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode),
      clientRepository.findByNameInOrg(caller.organizationId, input.name),
    ]);
    if (byCode) throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    if (byName) {
      throw new ConflictError(`A client named "${input.name}" already exists in this organization.`, { existingClientId: byName.id });
    }

    const client = await clientRepository.create({
      organizationId: caller.organizationId,
      clientCode: input.clientCode,
      name: input.name,
      legalName: input.legalName,
      status: input.status,
      email: input.email || undefined,
      phone: input.phone,
      website: input.website,
      address: input.address,
      accountManager: input.accountManager,
      notes: input.notes,
    });

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: client.id,
      afterData: { clientCode: client.clientCode, name: client.name, status: client.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return client;
  },

  async updateClient(caller: SanitizedUser, id: string, input: UpdateClientInput, meta: RequestMeta = {}): Promise<Client> {
    const existing = await loadClientInOrgOrThrow(id, caller.organizationId);

    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await clientRepository.findByNameInOrg(caller.organizationId, input.name);
      if (dup && dup.id !== id) {
        throw new ConflictError(`A client named "${input.name}" already exists in this organization.`);
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.legalName !== undefined) patch.legalName = input.legalName;
    if (input.status !== undefined) patch.status = input.status;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.website !== undefined) patch.website = input.website;
    if (input.address !== undefined) patch.address = input.address;
    if (input.accountManager !== undefined) patch.accountManager = input.accountManager;
    if (input.notes !== undefined) patch.notes = input.notes;

    const updated = await clientRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_UPDATED",
      resourceType: "client",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteClient(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    await loadClientInOrgOrThrow(id, caller.organizationId);
    // Soft delete only (§12) — clients are never physically removed, so
    // historical contracts/subscriptions/invoices (RESTRICT FKs, Phase 2)
    // and any lead that converted into this client stay intact.
    await clientRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ARCHIVED",
      resourceType: "client",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async dashboardCounts(organizationId: string) {
    return clientRepository.countByStatus(organizationId);
  },

  async recent(organizationId: string, limit: number) {
    return clientRepository.recentForOrg(organizationId, limit);
  },
};
