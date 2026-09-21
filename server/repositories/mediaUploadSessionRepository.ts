/** Upload-session data access (Phase 9 §14 — docs/MEDIA_ARCHITECTURE.md). One row per MediaAsset (1:1 — see the schema's doc comment on MediaUploadSession). */
import type { MediaUploadSession } from "@prisma/client";
import { prisma } from "../db/prisma";

export const mediaUploadSessionRepository = {
  async create(data: {
    mediaId: string;
    organizationId: string;
    uploadedById: string;
    storageKey: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<MediaUploadSession> {
    return prisma.mediaUploadSession.create({ data });
  },

  async findByMediaId(mediaId: string): Promise<MediaUploadSession | null> {
    return prisma.mediaUploadSession.findUnique({ where: { mediaId } });
  },

  /** Verifies possession of the upload secret via a DB equality lookup on its hash — never a fetch-then-compare in application code, matching workspaceInvitationRepository.findByToken's convention. */
  async findByMediaIdAndTokenHash(mediaId: string, tokenHash: string): Promise<MediaUploadSession | null> {
    return prisma.mediaUploadSession.findFirst({ where: { mediaId, tokenHash } });
  },

  /** Race-safe conditional completion — `WHERE id = ? AND completed_at IS NULL`. Returns the affected row count so a concurrent double-completion is visible as 0, never silently re-applied. */
  async markCompleted(id: string): Promise<number> {
    const result = await prisma.mediaUploadSession.updateMany({ where: { id, completedAt: null }, data: { completedAt: new Date() } });
    return result.count;
  },
};
