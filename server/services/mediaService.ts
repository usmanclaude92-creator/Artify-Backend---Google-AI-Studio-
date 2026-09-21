/**
 * Media Library orchestration (Phase 9 — docs/MEDIA_ARCHITECTURE.md).
 * Depends only on the `StorageProvider` abstraction (`server/storage`),
 * never on a concrete SDK — see docs/STORAGE_PROVIDER_ARCHITECTURE.md.
 *
 * Upload flow (§12/§34 — database/object-storage consistency): a MediaAsset
 * row is created PENDING before any bytes move, the browser uploads
 * directly to the signed URL, and `completeUpload` is the only path that
 * can mark a row ACTIVE — and only after independently verifying the
 * object actually exists in storage (`headObject`) and, where the
 * provider supports it, that its first bytes match the claimed MIME
 * type's signature (`readHeadBytes` + `verifyFileSignature`). The
 * client's own "upload succeeded" claim is never trusted on its own.
 */
import { randomUUID } from "node:crypto";
import { mediaRepository, toApiMedia, type ApiMediaAsset, type MediaFilters } from "../repositories/mediaRepository";
import { mediaUploadSessionRepository } from "../repositories/mediaUploadSessionRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { getStorageProvider, type SignedUpload } from "../storage";
import { generateUploadToken, hashToken } from "../utils/crypto";
import { buildStorageKey } from "../utils/storageKey";
import { extensionMatchesMimeType, isImageMimeType, mediaCategoryFor, verifyFileSignature, type AllowedMimeType } from "../utils/fileSignature";
import { config } from "../config/env";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateUploadSessionInput, UpdateMediaInput } from "../schemas/mediaSchemas";
import type { RequestMeta } from "./authService";
import type { MediaAsset } from "@prisma/client";

function maxSizeFor(mimeType: AllowedMimeType): number {
  return isImageMimeType(mimeType) ? config.mediaMaxImageSizeBytes : config.mediaMaxDocumentSizeBytes;
}

async function loadMediaOrThrow(id: string, organizationId: string): Promise<MediaAsset> {
  const media = await mediaRepository.findByIdInOrg(id, organizationId);
  if (!media) throw new NotFoundError("Media not found.");
  return media;
}

/**
 * Shared by pageService/postService when a caller sets `featuredMediaId`
 * (Phase 9 §24) — the media must belong to the same organization, be an
 * image type, and be ACTIVE (a PENDING/FAILED upload or already-ARCHIVED
 * asset cannot become a new featured image, though an existing reference
 * to now-archived media is left alone rather than silently broken — see
 * docs/MEDIA_ARCHITECTURE.md).
 */
export async function assertFeaturedMediaUsable(mediaId: string, organizationId: string): Promise<void> {
  const media = await mediaRepository.findByIdInOrg(mediaId, organizationId);
  if (!media) throw new ValidationError("featuredMediaId does not refer to a media asset in this organization.");
  if (media.status !== "ACTIVE") throw new ValidationError("featuredMediaId must refer to an ACTIVE media asset.");
  if (!isImageMimeType(media.mimeType)) throw new ValidationError("featuredMediaId must refer to an image.");
}

export const mediaService = {
  async listMedia(organizationId: string, filters: MediaFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return mediaRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getMedia(organizationId: string, id: string): Promise<ApiMediaAsset> {
    return toApiMedia(await loadMediaOrThrow(id, organizationId));
  },

  async createUploadSession(
    caller: SanitizedUser,
    input: CreateUploadSessionInput,
    meta: RequestMeta = {}
  ): Promise<{ media: ApiMediaAsset; upload: SignedUpload; uploadToken: string }> {
    const organizationId = caller.organizationId;

    if (!extensionMatchesMimeType(input.filename, input.mimeType)) {
      throw new ValidationError(`The file extension does not match the declared type (${input.mimeType}).`);
    }
    const maxSize = maxSizeFor(input.mimeType);
    if (input.sizeBytes > maxSize) {
      throw new ValidationError(`File exceeds the maximum allowed size for ${mediaCategoryFor(input.mimeType)}s (${maxSize} bytes).`);
    }

    const mediaId = randomUUID();
    const storageKey = buildStorageKey(organizationId, mediaId, input.filename);
    const provider = getStorageProvider();

    const media = await mediaRepository.create({
      id: mediaId,
      organizationId,
      originalFilename: input.filename,
      displayName: input.displayName,
      storageProvider: provider.name,
      storageBucket: config.objectStorageBucket || provider.name,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      altText: input.altText,
      caption: input.caption,
      uploadedById: caller.id,
    });

    const upload = await provider.createSignedUploadUrl({ key: storageKey, contentType: input.mimeType, maxSizeBytes: maxSize });

    const rawToken = generateUploadToken();
    await mediaUploadSessionRepository.create({
      mediaId,
      organizationId,
      uploadedById: caller.id,
      storageKey,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + config.mediaUploadSessionTtlMinutes * 60 * 1000),
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_INITIATED",
      resourceType: "media",
      resourceId: mediaId,
      afterData: { originalFilename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { media: toApiMedia(media), upload, uploadToken: rawToken };
  },

  async completeUpload(caller: SanitizedUser, id: string, token: string, meta: RequestMeta = {}): Promise<ApiMediaAsset> {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);

    if (media.status !== "PENDING") {
      throw new ConflictError(`This upload cannot be completed — media status is ${media.status}, not PENDING.`);
    }

    const session = await mediaUploadSessionRepository.findByMediaIdAndTokenHash(id, hashToken(token));
    if (!session) throw new ValidationError("Invalid upload token for this media.");
    if (session.completedAt) throw new ConflictError("This upload session has already been completed.");
    if (session.expiresAt.getTime() < Date.now()) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("This upload session has expired. Start a new upload.");
    }

    const provider = getStorageProvider();
    const head = await provider.headObject(media.storageKey);
    if (!head.exists) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("No object was found at the expected storage location — the upload did not complete.");
    }

    // Server-side magic-byte verification, never the client's claimed
    // Content-Type alone (§8). Skipped only if the provider genuinely
    // cannot return partial bytes (readHeadBytes returns empty in that
    // case) — every provider this codebase ships does support it.
    const headBytes = await provider.readHeadBytes(media.storageKey, 32);
    if (headBytes.length > 0 && !verifyFileSignature(media.mimeType as AllowedMimeType, headBytes)) {
      await mediaRepository.markFailed(id);
      throw new ValidationError("The uploaded file's content does not match its declared type.");
    }

    const maxSize = maxSizeFor(media.mimeType as AllowedMimeType);
    const verifiedSize = head.sizeBytes ?? Number(media.sizeBytes);
    if (verifiedSize > maxSize) {
      await mediaRepository.markFailed(id);
      throw new ValidationError(`The uploaded file exceeds the maximum allowed size (${maxSize} bytes).`);
    }

    // Atomically claim the session before writing — closes the race window
    // between the `session.completedAt` check above and this write, so two
    // concurrent completions can never both succeed (Phase 9 §38).
    const claimed = await mediaUploadSessionRepository.markCompleted(session.id);
    if (claimed === 0) throw new ConflictError("This upload session has already been completed.");

    const activatedCount = await mediaRepository.markActive(id, { sizeBytes: verifiedSize, mimeType: head.contentType ?? media.mimeType });
    if (activatedCount === 0) throw new ConflictError(`This upload cannot be completed — media status is no longer PENDING.`);
    const activated = await loadMediaOrThrow(id, organizationId);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_COMPLETED",
      resourceType: "media",
      resourceId: id,
      afterData: { sizeBytes: verifiedSize },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return toApiMedia(activated);
  },

  async getReadUrl(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<{ url: string; expiresAt: string }> {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);
    if (media.status !== "ACTIVE" && media.status !== "ARCHIVED") {
      throw new ConflictError("This media has no readable object yet.");
    }

    const provider = getStorageProvider();
    const url = await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaSignedUrlTtlSeconds });
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1000);

    // Never log the URL itself (it's a bearer credential) — only that one was issued, for whom, and when (§29).
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_SIGNED_URL_ISSUED",
      resourceType: "media",
      resourceId: id,
      afterData: { expiresAt: expiresAt.toISOString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { url, expiresAt: expiresAt.toISOString() };
  },

  async updateMedia(caller: SanitizedUser, id: string, input: UpdateMediaInput, meta: RequestMeta = {}): Promise<ApiMediaAsset> {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);

    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.altText !== undefined) patch.altText = input.altText;
    if (input.caption !== undefined) patch.caption = input.caption;
    if (input.visibility !== undefined) patch.visibility = input.visibility;

    const updated = await mediaRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_METADATA_UPDATED",
      resourceType: "media",
      resourceId: id,
      beforeData: { displayName: existing.displayName, altText: existing.altText, caption: existing.caption, visibility: existing.visibility },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return toApiMedia(updated);
  },

  async archiveMedia(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<ApiMediaAsset> {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This media is already archived.");

    const archivedCount = await mediaRepository.updateWhereStatus(id, ["PENDING", "ACTIVE", "FAILED"], { status: "ARCHIVED" });
    if (archivedCount === 0) throw new ConflictError("This media is already archived.");
    const updated = await loadMediaOrThrow(id, organizationId);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_ARCHIVED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return toApiMedia(updated);
  },

  async deleteMedia(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);

    const referenceCount = await mediaRepository.countContentReferences(id);
    if (referenceCount > 0) {
      throw new ConflictError(
        `This media is currently used as a featured image by ${referenceCount} page/post — detach it from that content before deleting.`
      );
    }

    await mediaRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_DELETED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status, originalFilename: existing.originalFilename },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
