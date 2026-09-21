/**
 * User data access. Route → service → repository → Prisma (Phase 1 §27
 * layering, unchanged in Phase 2).
 */
import type { User, UserStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config/env";

export const userRepository = {
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  },

  async listForIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return prisma.user.findMany({ where: { id: { in: ids } } });
  },

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async create(data: {
    organizationId: string;
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    title?: string;
    roleId: string;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName} ${data.lastName}`.trim(),
        title: data.title,
        roleId: data.roleId,
      },
    });
  },

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
  },

  /** Returns true if the account is now locked as a result of this failure. Threshold/duration are centralized config (server/config/env.ts), not hard-coded here. */
  async recordFailedLogin(userId: string): Promise<boolean> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= config.accountLockoutThreshold) {
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + config.accountLockoutDurationMinutes * 60 * 1000) },
      });
      return true;
    }
    return false;
  },

  isLocked(user: Pick<User, "lockedUntil">): boolean {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  },

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },

  async updateProfile(
    userId: string,
    data: Partial<Pick<User, "firstName" | "lastName" | "title" | "phone" | "status">>
  ): Promise<User> {
    const patch: Partial<Pick<User, "firstName" | "lastName" | "title" | "phone" | "status">> = { ...data };
    const updated = await prisma.user.update({ where: { id: userId }, data: patch });
    if (data.firstName !== undefined || data.lastName !== undefined) {
      await prisma.user.update({
        where: { id: userId },
        data: { displayName: `${updated.firstName} ${updated.lastName}`.trim() },
      });
    }
    return prisma.user.findUniqueOrThrow({ where: { id: userId } });
  },

  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    return prisma.user.update({ where: { id: userId }, data: { status } });
  },
};
