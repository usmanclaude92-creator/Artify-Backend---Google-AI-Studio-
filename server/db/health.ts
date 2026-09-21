/**
 * Real database readiness check (Phase 1 §10). Fixes Phase 0 finding S9:
 * artify-backend/server.ts previously hardcoded `"database": "connected"`
 * with no database in existence. This performs an actual query with a
 * bounded timeout and never exposes the connection string or a raw
 * driver error to the caller.
 */
import { prisma } from "./prisma";
import { logger } from "../core/logger";

const READINESS_TIMEOUT_MS = 2000;

export interface DependencyCheckResult {
  name: string;
  healthy: boolean;
  latencyMs?: number;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function checkDatabase(): Promise<DependencyCheckResult> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    return { name: "postgresql", healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    // Log full detail server-side only; callers of checkDatabase() never see `err`.
    logger.error({ err, event: "db_health_check_failed" }, "Database readiness check failed");
    return { name: "postgresql", healthy: false };
  }
}
