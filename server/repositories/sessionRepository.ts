/**
 * Session data access. Tokens are hashed at rest (Phase 2 §18 — see
 * prisma/schema.prisma's Session doc comment for why a fast SHA-256 hash
 * is appropriate here, unlike password hashing). Callers pass the raw
 * bearer token; this module hashes it before every read/write.
 */
import type { Session } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashToken } from "../utils/crypto";

export const sessionRepository = {
  async create(data: {
    token: string;
    userId: string;
    organizationId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<Session> {
    return prisma.session.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        organizationId: data.organizationId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  },

  async findValidByToken(token: string): Promise<Session | null> {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  },

  async touchLastUsed(id: string): Promise<void> {
    await prisma.session.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {
      // Best-effort — a race with revocation/expiry here is not a correctness issue.
    });
  },

  async revoke(token: string): Promise<void> {
    await prisma.session
      .update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
      .catch(() => {
        // Token didn't exist — logout is idempotent, nothing to do.
      });
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  /** Revokes every other active session for the user, keeping the one matching `exceptToken` — used by change-password to avoid logging the caller out of the session they just authenticated the change with. */
  async revokeAllForUserExcept(userId: string, exceptToken: string): Promise<void> {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: hashToken(exceptToken) } },
      data: { revokedAt: new Date() },
    });
  },

  /** Self-service session list (Phase 4 Security/Sessions UI) — active (unexpired, unrevoked) sessions for one user, safe fields only (never tokenHash). */
  async listActiveForUser(userId: string): Promise<Session[]> {
    return prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Revokes a session only if it belongs to `userId` — returns true if a row was actually revoked, so the route can 404 rather than leak whether a foreign session id exists. */
  async revokeByIdForUser(id: string, userId: string): Promise<boolean> {
    const result = await prisma.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  },

  async countActiveForOrganization(organizationId: string): Promise<number> {
    return prisma.session.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: new Date() } } });
  },
};
