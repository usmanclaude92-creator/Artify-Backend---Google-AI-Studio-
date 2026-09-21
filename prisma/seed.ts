/**
 * Deterministic development/test seed (Phase 2 §40/§41). NOT run against
 * production automatically — there is no cron/deploy hook that calls this;
 * it is a manual `npm run db:seed` a developer runs locally. Seeds:
 *  - Artify's own internal organization (type=INTERNAL)
 *  - the 5 system roles + full permission catalog + role_permissions
 *  - one Super Administrator user (bootstrap admin — §41: password comes
 *    from SEED_ADMIN_PASSWORD, never hardcoded, never defaulted)
 *
 * Does NOT seed leads/clients/products/content/fake business records —
 * that would just recreate the Phase 0 prototype's seedData.ts problem one
 * layer down. Business data seeding, if ever needed, belongs to whichever
 * phase implements that domain, as its own explicit, reviewed fixture set.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedRolesAndPermissions } from "./rolePermissionSeed";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const roleIds = await seedRolesAndPermissions(prisma);
  console.log("Seeded system roles and permission catalog.");

  const internalOrg = await prisma.organization.upsert({
    where: { slug: "artify-solutions" },
    update: {},
    create: {
      name: "Artify Solutions",
      legalName: "Artify Solutions HQ",
      slug: "artify-solutions",
      type: "INTERNAL",
      tier: "ENTERPRISE",
      status: "ACTIVE",
      country: "OM",
      currency: "OMR",
    },
  });

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@artifysols.local";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be set to seed a local admin account " +
        '(e.g. SEED_ADMIN_PASSWORD="ChangeMe123!" npm run db:seed) — no default password is hardcoded here.'
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed skipped: ${email} already exists.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      organizationId: internalOrg.id,
      email,
      passwordHash,
      firstName: "Super",
      lastName: "Administrator",
      displayName: "Super Administrator",
      title: "Platform Operator",
      roleId: roleIds.SUPER_ADMIN,
    },
  });

  await prisma.organizationMembership.create({
    data: {
      userId: user.id,
      organizationId: internalOrg.id,
      roleId: roleIds.SUPER_ADMIN,
      status: "ACTIVE",
      isPrimary: true,
    },
  });

  console.log(`Seeded ${email} as Super Administrator of "${internalOrg.name}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
