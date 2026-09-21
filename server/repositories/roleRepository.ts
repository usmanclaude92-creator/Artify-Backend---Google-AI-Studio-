import { prisma } from "../db/prisma";
import type { ResolvedRole } from "../types/domain";

export const roleRepository = {
  async findByKey(key: string) {
    return prisma.role.findUnique({ where: { key } });
  },

  async findById(id: string) {
    return prisma.role.findUnique({ where: { id } });
  },

  /** All roles with their resolved permission sets — GET /api/v1/roles. */
  async listAllResolved(): Promise<ResolvedRole[]> {
    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key),
    }));
  },

  /** Resolves a role plus its full permission-key set via role_permissions — the RBAC join, computed at read time, never stored redundantly per-user. */
  async resolveById(roleId: string): Promise<ResolvedRole | null> {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) return null;

    return {
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key),
    };
  },
};
