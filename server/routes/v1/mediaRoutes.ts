/**
 * Media Library CRUD + upload session + signed read URL (Phase 9 —
 * docs/MEDIA_ARCHITECTURE.md). Reuses the existing media.read/upload/
 * update/delete permissions (Phase 2) unchanged — archive uses
 * media.delete, matching content.delete's reuse for Page/Post archive
 * (Phase 8).
 *
 * `/local-object` is the dev-only local-filesystem provider's own
 * upload/read endpoint (server/storage/localFilesystemProvider.ts) — it
 * is intentionally mounted BEFORE `authenticateToken` because a real
 * presigned cloud URL isn't authorized by a session cookie either; it's
 * authorized by its own short-lived HMAC signature, verified here the
 * same way. It only ever does anything when the local provider is
 * actually selected (OBJECT_STORAGE_PROVIDER=none) — otherwise 404.
 */
import { Router } from "express";
import express from "express";
import { mediaService } from "../../services/mediaService";
import { getStorageProvider } from "../../storage";
import { localFilesystemStorageProvider, verifyLocalStorageToken } from "../../storage/localFilesystemProvider";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { ValidationError } from "../../core/errors";
import { createUploadSessionSchema, completeUploadSchema, listMediaQuerySchema, updateMediaSchema } from "../../schemas/mediaSchemas";
import { config } from "../../config/env";

const router = Router();

function requestMeta(req: { ip?: string; headers: Record<string, unknown> }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined };
}

router.put(
  "/local-object",
  express.raw({ type: () => true, limit: Math.max(config.mediaMaxImageSizeBytes, config.mediaMaxDocumentSizeBytes) }),
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("upload", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired upload authorization." });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    await localFilesystemStorageProvider.writeObject(key, body);
    res.status(200).json({ ok: true });
  })
);

router.get(
  "/local-object",
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("read", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired read authorization." });
      return;
    }
    try {
      const bytes = await localFilesystemStorageProvider.readObject(key);
      res.status(200).end(bytes);
    } catch {
      res.status(404).json({ error: "Object not found." });
    }
  })
);

router.use(authenticateToken);

router.get(
  "/",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const query = listMediaQuerySchema.parse(req.query);
    const { rows, total } = await mediaService.listMedia(
      req.user!.organizationId,
      { search: query.search, status: query.status, mimeType: query.mimeType, uploadedById: query.uploadedById, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { media: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.getMedia(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { media });
  })
);

router.get(
  "/:id/url",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const result = await mediaService.getReadUrl(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, result);
  })
);

router.post(
  "/upload-session",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = createUploadSessionSchema.parse(req.body);
    const result = await mediaService.createUploadSession(req.user!, input, requestMeta(req));
    sendSuccess(res, result, 201);
  })
);

router.post(
  "/:id/complete",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = completeUploadSchema.parse(req.body);
    if (!input.token) throw new ValidationError("token is required.");
    const media = await mediaService.completeUpload(req.user!, req.params.id!, input.token, requestMeta(req));
    sendSuccess(res, { media });
  })
);

router.patch(
  "/:id",
  requirePermission("media.update"),
  asyncHandler(async (req, res) => {
    const input = updateMediaSchema.parse(req.body);
    const media = await mediaService.updateMedia(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { media });
  })
);

router.post(
  "/:id/archive",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.archiveMedia(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { media });
  })
);

router.delete(
  "/:id",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    await mediaService.deleteMedia(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { message: "Media deleted." });
  })
);

export default router;
