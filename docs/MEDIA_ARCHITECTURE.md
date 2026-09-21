# Media Architecture (Phase 9)

## Schema reuse — one new table, no duplicate models

Phase 2 already defined `MediaAsset` (metadata-only — its own doc comment: "object storage itself is Phase 9") with `organizationId`, `filename`, `storageKey` (unique), `mimeType`, `sizeBytes`, `width`/`height`, `altText`/`caption`, `status`, `uploadedById`, timestamps, `deletedAt`. It had zero application code and zero rows in every environment (verified via grep and `psql` before touching anything, the same inspection this project has run before every phase). Phase 9 evolves it rather than replacing it:

- **Renamed** `filename` → `originalFilename`, added `displayName` (the two purposes the brief's field list separates — the upload's real name vs. an editable label) — safe, 0 existing rows.
- **Added** `storageProvider`, `storageBucket` (which provider/bucket actually holds the object — matters because the configured provider can change over an environment's lifetime; each asset remembers where it really lives), `checksum`, `durationSeconds` (for future audio/video), `visibility` (`PRIVATE`/`PUBLIC` — see below).
- **Renamed** the `MediaStatus` enum values `UPLOADING`/`READY`/`DELETED` → `PENDING`/`ACTIVE`/`ARCHIVED` (kept `FAILED` as-is) — the exact lifecycle names the brief specifies (§20), and a rename rather than a new enum since 0 rows existed. See "Lifecycle" below for why `ARCHIVED` and the pre-existing `deletedAt` column are two different things, not duplicates.
- **Added** one new model, `MediaUploadSession` (§14) — nothing conceptually new was invented beyond what the brief's upload-session requirement asked for.
- **Added** `featuredMediaId` to `Page` and `Post` (§23/§24) — a real FK to `MediaAsset`, `onDelete: SetNull`, replacing what would otherwise have to be an arbitrary client-supplied URL.

Migration: `prisma/migrations/20260928000001_phase9_media_library/` — see `docs/PHASE_9_IMPLEMENTATION.md` for the exact SQL and verification.

## Ownership: organization-scoped, like CMS content

`MediaAsset.organizationId` was already present in Phase 2's schema — media is tenant data, not a platform-global catalog (unlike `Product`). `mediaRepository` follows the same `findByIdInOrg`-only convention as every organization-scoped repository since Phase 5: there is no bare `findById` anywhere in the media code path, so a cross-organization id resolves to 404, never another tenant's asset.

## Upload flow (§12/§34) — database/object-storage consistency

Postgres and object storage cannot share one ACID transaction, so the flow is a deliberate three-phase sequence, never a single "upload and trust it":

```
1. POST /media/upload-session
   → validate MIME/extension/size against the centralized allowlist and limits
   → create a MediaAsset row: status = PENDING
   → ask the StorageProvider for a signed upload URL
   → create a MediaUploadSession (hashed bearer token, TTL)
   → return { media, upload: {url, method, headers}, uploadToken } to the browser

2. Browser → PUT directly to `upload.url`
   (server never proxies the bytes for a real cloud provider — see
   docs/STORAGE_PROVIDER_ARCHITECTURE.md for the local-filesystem
   exception, which does proxy through this same server's own routes)

3. POST /media/:id/complete { token }
   → media must still be PENDING
   → the upload session must exist, be unexpired, and not already completed
     (all three independently re-checked, never assumed from step 1)
   → provider.headObject(key) — does the object genuinely exist? (never
     trusts the browser's own "upload succeeded" claim)
   → provider.readHeadBytes(key, 32) + verifyFileSignature() — do the
     actual bytes' magic number match the claimed MIME type?
   → verified size checked against the same centralized limit again
   → only if every check passes: atomically claim the upload session
     (conditional UPDATE ... WHERE completed_at IS NULL) and mark the
     media ACTIVE (conditional UPDATE ... WHERE status = 'PENDING') —
     see "Concurrency" below for why both are conditional, not a plain
     UPDATE guarded only by an earlier JS-level check
```

Any failure at step 3 marks the media `FAILED` (`markFailed`), never leaves it silently claiming success. A `PENDING` row whose browser upload never happens (tab closed, network dropped) simply stays `PENDING` forever — Phase 9 does not build an orphan-cleanup worker (§20 explicitly defers this); a future Phase 13 background-job system is the intended owner of periodically sweeping stale `PENDING` rows past their upload session's `expiresAt`. Documented here as a known, deliberate gap, not an oversight.

## Concurrency (§38)

Both `completeUpload` and `archiveMedia` use the same **conditional `updateMany` + affected-row-count** pattern this codebase has used since Phase 5 for lead conversion and workspace provisioning, and since Phase 8 for CMS optimistic concurrency: `UPDATE media_assets SET status = 'ACTIVE' WHERE id = ? AND status = 'PENDING'`, checking the returned count rather than trusting a JS-level `if (media.status !== 'PENDING')` check made moments earlier against a snapshot that a concurrent request could invalidate in between. `mediaUploadSessionRepository.markCompleted` is the same shape (`WHERE completed_at IS NULL`). `tests/integration/mediaConcurrency.test.ts` fires genuinely concurrent HTTP requests at the same completion/archive and asserts the database ends in exactly the correct state (`[200, 409]`, never `[200, 200]`) — an earlier, unconditional-update version of this code was caught failing exactly this way under real parallel load before being fixed.

## Lifecycle: `status` vs. `deletedAt` (§19/§20)

Following the exact dual-mechanism precedent set for `Client` (Phase 5) and `Page`/`Post` (Phase 8):

- **`status`** (`PENDING` → `ACTIVE`/`FAILED` → `ARCHIVED`) is the upload-and-visibility lifecycle. `ARCHIVED` is reached only through the dedicated `POST /media/:id/archive` endpoint — hidden from the Media Library's default view and from the CMS media picker (which only offers `ACTIVE` images), but still directly resolvable (`GET /media/:id`, `GET /media/:id/url`) so a page/post that already referenced it before archiving keeps working. Archiving referenced media is explicitly allowed and does **not** silently break the referencing content — verified directly in `tests/integration/mediaCmsIntegration.test.ts`.
- **`deletedAt`** is the real soft-delete, set only by `DELETE /media/:id` (never a physical row delete). Unlike archive, delete is **blocked** (409) while the media is referenced as any non-deleted Page's or Post's `featuredMediaId` (`mediaRepository.countContentReferences`) — deleting it would leave a dangling, 404-ing reference in already-authored content, which the brief explicitly forbids ("do not break published CMS content"). The caller must detach the reference first.

## Featured images (§23/§24)

`Page.featuredMediaId`/`Post.featuredMediaId` reference `MediaAsset` directly — never a raw client-supplied URL. `assertFeaturedMediaUsable` (`mediaService.ts`, shared by `pageService`/`postService`) enforces, on every create/update: the media must belong to the caller's own organization (IDOR-safe — tested against a foreign organization's media), must be an image MIME type (a PDF cannot become a featured image), and must be `ACTIVE` (a still-`PENDING` or `FAILED` upload cannot be attached). The featured image can be changed independently of a content edit — it lives on the `Page`/`Post` row, not the revision — except while the content is `ARCHIVED`, which stays fully read-only. Attaching/detaching audits `MEDIA_ATTACHED_TO_CONTENT`/`MEDIA_DETACHED_FROM_CONTENT` on the *page/post's* audit trail.

## Content body media (§25)

Page/Post bodies remain the plain-text/HTML `ContentRevision.body` field Phase 8 built — Phase 9 does not introduce a rich structured content format or rewrite the editor. No new mechanism for embedding media *inside* body content was added this phase (out of the brief's explicit boundary: "do not redesign the entire content editor"); only the one first-class `featuredMediaId` reference per Page/Post exists today. A future phase that wants inline body media should resolve it the same way — a validated `mediaId` reference resolved server-side to a signed URL at read time, never a raw storage URL baked into stored content — documented here as the intended direction, not built.

## Public vs. private media (§16)

`MediaAsset.visibility` (`PRIVATE`/`PUBLIC`, default `PRIVATE`) exists in the schema and is settable via `PATCH /media/:id`, but **Phase 9 does not implement a separate public-delivery path** — every read, public or private, still goes through the authenticated, permission-gated `GET /media/:id/url` and gets a short-lived signed URL. This is deliberate groundwork for Phase 11 (public website integration), not a shipped feature: the column lets a future phase distinguish "this asset may be served by the public site once its owning content is published" from "this asset must always go through the authenticated signed-URL path," without a schema change at that point. Nothing in Phase 9 bypasses authentication/authorization based on `visibility` today.

## MIME allowlist & validation (§7/§8)

`server/utils/fileSignature.ts` is the single source of truth: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`, `application/pdf` — nothing else is accepted anywhere in the upload path (`createUploadSessionSchema`'s Zod `z.enum` is generated from this same list, so the allowlist can't drift between validation and documentation). Every upload is checked server-side on three independent axes, none of which trusts the client alone: the claimed MIME type must be in the allowlist; the filename's extension must match the claimed MIME type (`extensionMatchesMimeType`); and at completion, the object's actual first bytes must match that MIME type's real magic number (`verifyFileSignature`) — an executable (`MZ` header) or script declared as `image/png` is rejected and the media marked `FAILED`, proven directly in `tests/unit/storageProvider.test.ts` and `tests/integration/media.test.ts`. Size limits are centralized and configurable (`MEDIA_MAX_IMAGE_SIZE_BYTES`/`MEDIA_MAX_DOCUMENT_SIZE_BYTES`), never a magic number scattered in a controller, and re-enforced against the *verified* (not claimed) size at completion.
