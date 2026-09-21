/**
 * Password-reset token data access. Raw tokens are never persisted — only
 * a SHA-256 hash (server/utils/crypto.ts's hashToken, same rationale as
 * Session.tokenHash: the value is high-entropy random, not a low-entropy
 * secret). Callers pass the raw token; this module hashes it before every
 * read/write, mirroring sessionRepository's pattern.
 */
import type { PasswordResetToken } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashToken } from "../utils/crypto";

export const passwordResetRepository = {
  async create(data: {
    token: string;
    userId: string;
    expiresAt: Date;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<PasswordResetToken> {
    return prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    });
  },

  /** Returns the token row only if it is unexpired AND unused — a used or expired token is treated identically to a nonexistent one by every caller. */
  async findValidByToken(token: string): Promise<PasswordResetToken | null> {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  },

  async markUsed(id: string): Promise<void> {
    await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  },

  /** A fresh reset request invalidates any prior outstanding token for the same user — at most one usable reset credential at a time. */
  async invalidateAllForUser(userId: string): Promise<void> {
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  },
};
