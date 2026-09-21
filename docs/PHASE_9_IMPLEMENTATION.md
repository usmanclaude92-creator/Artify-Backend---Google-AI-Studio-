# Phase 9 — Media Library & Object Storage

Implementation notes, scoped to the brief: a production media metadata + object storage abstraction with a real upload/completion flow, CMS featured-image integration, and a Control Center Media Library — evolving the Phase 2 `MediaAsset` schema rather than replacing it. No payment processing, subscriptions, public website rendering, AI, or background-job workers — see `docs/MEDIA_ARCHITECTURE.md` and `docs/STORAGE_PROVIDER_ARCHITECTURE.md` for the architecture and `docs/PHASE_9_COMPLETION_REPORT.md` for status.

## What changed, and why

### 1. Inspection findings
`MediaAsset` (Phase 2) had metadata fields but zero application code and zero rows in every environment (verified via grep + `psql` before touching anything). `media.read/upload/update/delete` permissions were already seeded but ungranted-in-effect (nothing enforced them). `Page`/`Post` (Phase 8) had no featured-image field. `server/config/env.ts` already had `OBJECT_STORAGE_PROVIDER: z.enum(["none", "s3", "r2", "supabase"])` scaffolded from an earlier phase, explicitly marked "Phase 9 — not yet implemented" in `.env.example` — Phase 9 completes exactly this.

### 2. Database migration (`prisma/migrations/20260928000001_phase9_media_library/`)
`MediaStatus` enum values renamed `UPLOADING/READY/DELETED` → `PENDING/ACTIVE/ARCHIVED` (kept `FAILED`) — safe, 0 existing rows, verified before renaming (same pattern as Phase 7's `DEPRECATED → INACTIVE`). New `MediaVisibility` enum (`PRIVATE`/`PUBLIC`). `MediaAsset` gained `displayName`, `storageProvider`, `storageBucket`, `checksum`, `durationSeconds`, `visibility`; `filename` renamed to `originalFilename`. New `MediaUploadSession` model (1:1 with `MediaAsset`, hashed bearer token). `Page.featuredMediaId`/`Post.featuredMediaId` added (FK to `MediaAsset`, `onDelete: SetNull`). Verified as both an upgrade (`artify_dev`, `artify_test`) and from a from-scratch database (all 8 migrations apply in order).

### 3. Storage provider abstraction
`server/storage/types.ts`'s `StorageProvider` interface, four implementations (`LocalFilesystemStorageProvider`, `S3CompatibleStorageProvider` for s3/r2, `SupabaseStorageProvider`, `TestStorageProvider`), one factory (`getStorageProvider()`) that picks by `config.objectStorageProvider` — `NODE_ENV=test` always gets the in-memory test provider regardless. `mediaService.ts` depends only on the interface. Full detail: `docs/STORAGE_PROVIDER_ARCHITECTURE.md`.

### 4. Environment configuration
`server/config/env.ts` gained `OBJECT_STORAGE_REGION/ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/FORCE_PATH_STYLE`, `SUPABASE_STORAGE_URL/SERVICE_ROLE_KEY`, `LOCAL_STORAGE_DIR`, `MEDIA_MAX_IMAGE_SIZE_BYTES/MEDIA_MAX_DOCUMENT_SIZE_BYTES/MEDIA_SIGNED_URL_TTL_SECONDS/MEDIA_UPLOAD_SESSION_TTL_MINUTES` — all validated, conditionally required per selected provider (`superRefine`), and `OBJECT_STORAGE_PROVIDER=none` is now rejected in production/staging (the local-filesystem provider was previously unconstrained since it did nothing; now that it's real, it needed this guard). `.env.example` updated with placeholders only, no real values.

### 5. Backend additions
Repositories: `mediaRepository` (org-scoped `findByIdInOrg`-only, `BigInt` `sizeBytes` converted to `number` at the repository boundary since `res.json()` cannot serialize a native `BigInt`, race-safe `updateWhereStatus`), `mediaUploadSessionRepository`. Service: `mediaService` (upload-session creation, completion with independent server-side verification, signed-read-URL issuance, metadata update, archive, reference-checked delete) plus the shared `assertFeaturedMediaUsable` export `pageService`/`postService` both call. Routes: `mediaRoutes` (`/media`, plus the dev-only unauthenticated `/media/local-object` pair for the local provider). Utilities: `server/utils/fileSignature.ts` (MIME allowlist + magic-byte verification), `server/utils/storageKey.ts` (safe key generation), `generateUploadToken` added to `server/utils/crypto.ts`.

### 6. Endpoints

```
GET    /api/v1/media                    media.read
POST   /api/v1/media/upload-session     media.upload
POST   /api/v1/media/:id/complete       media.upload
GET    /api/v1/media/:id                media.read
GET    /api/v1/media/:id/url            media.read
PATCH  /api/v1/media/:id                media.update
POST   /api/v1/media/:id/archive        media.delete
DELETE /api/v1/media/:id                media.delete
```

No new permission keys — `media.read/upload/update/delete` were already seeded in Phase 2 and reused exactly as-is (ADMIN full, MANAGER read/upload/update, USER read/upload, VIEWER read — same tiers already granted). Archive uses `media.delete`'s tier, matching Page/Post archive reusing `content.delete` in Phase 8.

### 7. CMS integration
`createPageSchema`/`createPostSchema`/`updatePageSchema`/`updatePostSchema` gained `featuredMediaId`. `pageService.createPage/updatePage` and `postService.createPost/updatePost` validate it via `assertFeaturedMediaUsable` (org, type, status) and persist it; `updatePage`/`updatePost` additionally audit `MEDIA_ATTACHED_TO_CONTENT`/`MEDIA_DETACHED_FROM_CONTENT` when it changes. No existing Phase 8 field stored a raw media URL, so no legacy-URL migration was needed (§42 is not applicable to this codebase's actual data — documented rather than solved for a scenario that doesn't exist here).

### 8. Audit logging
Reuses the existing unmodified `auditLogRepository.record()`. Events: `MEDIA_UPLOAD_INITIATED`, `MEDIA_UPLOAD_COMPLETED`, `MEDIA_METADATA_UPDATED`, `MEDIA_ARCHIVED`, `MEDIA_DELETED`, `MEDIA_SIGNED_URL_ISSUED` (metadata only — expiry and who, never the URL itself), `MEDIA_ATTACHED_TO_CONTENT`/`MEDIA_DETACHED_FROM_CONTENT` (recorded against the page/post, not the media).

### 9. Frontend
`src/lib/api.ts` gained `mediaApi` and its types, including the one call that deliberately bypasses `apiClient` (`uploadToSignedUrl` — a raw binary `fetch` PUT with no Authorization header, since a signed URL is self-authorizing). `NavItem.section` gained a "Media Library" entry under the existing `"CMS"` section, gated by `media.read`. New page: `MediaLibraryPage.tsx` (grid, search/filter/pagination, upload modal, metadata editor, archive/delete with confirmation). New shared component: `src/components/common/MediaPickerModal.tsx` (search/paginate `ACTIVE` images only, used by both `PagesPage.tsx` and `PostsPage.tsx`'s new "Featured image" field).

### 10. Deliberate Phase 9 scope boundaries
No image processing/thumbnail generation (no new dependency for it — out of scope per the brief). No public unauthenticated media delivery (`visibility` column exists as groundwork for Phase 11, not wired to bypass auth today). No orphan-cleanup worker for abandoned `PENDING` uploads (explicitly deferred to a future Phase 13 background-job system). No rich inline-body media embedding — Page/Post bodies remain Phase 8's plain body field; only the one first-class `featuredMediaId` reference exists.
