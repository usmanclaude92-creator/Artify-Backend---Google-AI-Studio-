/** Organization-scoped configuration (Phase 4 Settings foundation — Phase 2's `system_settings` table, no schema change needed). */
import type { Prisma, SettingType } from "@prisma/client";
import { prisma } from "../db/prisma";

export const systemSettingRepository = {
  async listForOrganization(organizationId: string) {
    return prisma.systemSetting.findMany({ where: { organizationId }, orderBy: { key: "asc" } });
  },

  async upsert(data: {
    organizationId: string;
    key: string;
    value: unknown;
    type: SettingType;
    description?: string;
    updatedById: string;
  }) {
    return prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: data.organizationId, key: data.key } },
      update: {
        value: data.value as Prisma.InputJsonValue,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById,
      },
      create: {
        organizationId: data.organizationId,
        key: data.key,
        value: data.value as Prisma.InputJsonValue,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById,
      },
    });
  },
};
