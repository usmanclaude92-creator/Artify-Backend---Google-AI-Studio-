/**
 * Workspace provisioning + lifecycle (Phase 6 —
 * docs/WORKSPACE_PROVISIONING.md). A workspace is a normal Organization row
 * (type=CLIENT) linked 1:1 to a CRM Client via
 * Client.workspaceOrganizationId — never a parallel tenant model (§4/§34).
 *
 * Workspace status reuses OrganizationStatus: TRIAL=PENDING, ACTIVE=ACTIVE,
 * SUSPENDED=SUSPENDED, ARCHIVED=DEACTIVATED (documented in schema.prisma).
 */
import { prisma } from "../db/prisma";
import { clientRepository } from "../repositories/clientRepository";
import { workspaceRepository, type WorkspaceFilters } from "../repositories/workspaceRepository";
import { freshChecklist } from "../repositories/clientOnboardingRepository";
import { organizationMembershipRepository } from "../repositories/organizationMembershipRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { onboardingService } from "./onboardingService";
import { AuthorizationError, ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { ProvisionWorkspaceInput, UpdateWorkspaceInput } from "../schemas/workspaceSchemas";
import type { RequestMeta } from "./authService";
import { Prisma, type Client, type Organization } from "@prisma/client";

const SENSITIVE_STATUSES = new Set(["SUSPENDED", "ARCHIVED"]);

// PENDING(TRIAL) -> ACTIVE -> SUSPENDED -> ACTIVE ... -> ARCHIVED(terminal).
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  TRIAL: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: [],
};

function assertValidWorkspaceTransition(current: string, next: string): void {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictError(`Workspace cannot move from ${current} to ${next}.`);
  }
}

async function loadClientInOrgOrThrow(clientId: string, organizationId: string): Promise<Client> {
  const client = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client) throw new NotFoundError("Client not found.");
  return client;
}

async function loadWorkspaceForOwnerOrThrow(id: string, ownerOrganizationId: string) {
  const workspace = await workspaceRepository.findByIdForOwner(id, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}

export const workspaceService = {
  async listWorkspaces(ownerOrganizationId: string, filters: WorkspaceFilters, page: number, limit: number) {
    return workspaceRepository.list(ownerOrganizationId, filters, page, limit);
  },

  async getWorkspace(ownerOrganizationId: string, id: string) {
    return loadWorkspaceForOwnerOrThrow(id, ownerOrganizationId);
  },

  /**
   * The core transactional provisioning operation (§13). Idempotency/
   * concurrency (§14/§15): if the client is already provisioned, this
   * throws a 409 rather than creating a second workspace; a conditional
   * `updateMany` inside the transaction (mirroring leadService.convertLead)
   * guards against two concurrent provisioning requests for the same
   * client both succeeding — the loser's transaction rolls back entirely,
   * including the Organization row it just created.
   */
  async provisionWorkspace(caller: SanitizedUser, clientId: string, input: ProvisionWorkspaceInput, meta: RequestMeta = {}): Promise<Organization> {
    const client = await loadClientInOrgOrThrow(clientId, caller.organizationId);
    if (client.workspaceOrganizationId) {
      throw new ConflictError("This client has already been provisioned into a workspace.", {
        workspaceOrganizationId: client.workspaceOrganizationId,
      });
    }

    const name = input.name?.trim() || client.name;
    const slug = await workspaceRepository.findUniqueSlug(name);

    let result: { workspace: Organization; onboardingStarted: boolean };
    try {
      result = await prisma.$transaction(async (tx) => {
        const workspace = await tx.organization.create({
          data: {
            name,
            slug,
            type: "CLIENT",
            tier: "GROWTH",
            status: "TRIAL", // PENDING — see module doc comment
            timezone: input.timezone ?? "UTC",
            currency: input.currency ?? "USD",
            locale: input.locale ?? "en",
          },
        });

        const linked = await tx.client.updateMany({
          where: { id: clientId, organizationId: caller.organizationId, workspaceOrganizationId: null },
          data: { workspaceOrganizationId: workspace.id },
        });
        if (linked.count !== 1) {
          // Lost a concurrent provisioning race — rolling back discards the
          // Organization row just created above; no orphaned workspace.
          throw new ConflictError("This client has already been provisioned into a workspace.");
        }

        let onboarding = await tx.clientOnboarding.findUnique({ where: { clientId } });
        if (!onboarding) {
          onboarding = await tx.clientOnboarding.create({
            data: {
              organizationId: caller.organizationId,
              clientId,
              createdById: caller.id,
              status: "IN_PROGRESS",
              startedAt: new Date(),
              checklist: freshChecklist() as never,
              currentStep: "CLIENT_VERIFIED",
            },
          });
        }

        return { workspace, onboardingStarted: !!onboarding };
      });
    } catch (err) {
      // Two concurrent provisioning requests for the same client can also
      // race on the workspace's own unique slug (both compute the same
      // uniqueness check before either commits) before ever reaching the
      // client-link guard above — folded into the same clean conflict
      // response rather than surfacing a raw database error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This client has already been provisioned into a workspace.");
      }
      throw err;
    }

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "WORKSPACE_PROVISIONED",
      resourceType: "organization",
      resourceId: result.workspace.id,
      afterData: { clientId, name: result.workspace.name, status: result.workspace.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await onboardingService.completeStepForClient(clientId, "WORKSPACE_CREATED", caller.id);

    return result.workspace;
  },

  async updateWorkspace(caller: SanitizedUser, id: string, input: UpdateWorkspaceInput, callerPermissions: string[], meta: RequestMeta = {}): Promise<Organization> {
    const existing = await loadWorkspaceForOwnerOrThrow(id, caller.organizationId);

    if (input.status !== undefined) {
      assertValidWorkspaceTransition(existing.status, input.status);
      if (SENSITIVE_STATUSES.has(input.status) && !callerPermissions.includes("workspaces.suspend") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "workspaces.suspend"');
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.email !== undefined) patch.email = input.email || null;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.website !== undefined) patch.website = input.website;
    if (input.address !== undefined) patch.address = input.address;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.status !== undefined) patch.status = input.status;

    const updated = await workspaceRepository.update(id, patch);

    const action = input.status === "SUSPENDED" ? "WORKSPACE_SUSPENDED" : input.status === "ARCHIVED" ? "WORKSPACE_DEACTIVATED" : "WORKSPACE_UPDATED";

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action,
      resourceType: "organization",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    if (input.name !== undefined || Object.keys(patch).some((k) => ["timezone", "currency", "locale", "email", "phone", "address"].includes(k))) {
      await onboardingService.completeStepForClient(existing.provisionedForClient!.id, "WORKSPACE_CONFIGURED", caller.id);
    }

    return updated;
  },

  async listMembers(caller: SanitizedUser, workspaceId: string, page: number, limit: number) {
    await loadWorkspaceForOwnerOrThrow(workspaceId, caller.organizationId);
    return organizationMembershipRepository.listForOrganization(workspaceId, page, limit);
  },
};
