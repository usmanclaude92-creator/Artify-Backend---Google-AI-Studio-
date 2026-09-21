/**
 * Vitest setup file. Runs once per test file, after vitest.config.ts has
 * already loaded .env.test (see that file's comment for why the env load
 * itself lives there, not here — an ES module import-hoisting race).
 *
 * Seeds the role/permission reference data (idempotent upserts — safe to
 * run repeatedly) — authService.register() looks up the ADMIN role by key
 * and fails a real, meaningful way if it's missing, so every integration/
 * security test that registers a user needs this to have run first.
 * Tenant data (organizations/users/sessions/audit_logs) is wiped per test
 * via tests/helpers/db.ts's resetDb() instead — roles and permissions are
 * reference/configuration data, not per-test fixtures.
 */
import { prisma } from "../server/db/prisma";
import { seedRolesAndPermissions } from "../prisma/rolePermissionSeed";

await seedRolesAndPermissions(prisma);
