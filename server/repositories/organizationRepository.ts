import type { Organization } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export const organizationRepository = {
  async findById(id: string): Promise<Organization | null> {
    return prisma.organization.findUnique({ where: { id } });
  },

  async findBySlug(slug: string): Promise<Organization | null> {
    return prisma.organization.findUnique({ where: { slug } });
  },

  /** Finds the platform operator's own organization (type=INTERNAL). Used for "global" settings ownership — see SystemSetting's schema doc comment. */
  async findInternal(): Promise<Organization | null> {
    return prisma.organization.findFirst({ where: { type: "INTERNAL" } });
  },

  async create(data: { name: string }): Promise<Organization> {
    const baseSlug = slugify(data.name) || "organization";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }

    return prisma.organization.create({
      data: {
        name: data.name,
        slug,
        tier: "GROWTH",
        status: "TRIAL",
        type: "CLIENT",
      },
    });
  },
};
