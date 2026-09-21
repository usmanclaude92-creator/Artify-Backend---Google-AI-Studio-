# ADR-006: Object Storage — S3-Compatible Storage for Media

## Status
Accepted (Phase 0)

## Context
No file/media storage integration exists in either repository today. The Media module (`artify-backend/src/components/modules/MediaModule.tsx`) and CMS featured-image fields (`ArticleRecord.featuredImage`) currently only store metadata or hotlinked external URLs (e.g. Unsplash URLs in `server/core/db.ts` seed data) — no actual upload path exists (`CURRENT_STATE.md` §1.6, §2.2).

## Decision
Adopt an S3-compatible object storage provider (AWS S3, Cloudflare R2, or the storage product bundled with the chosen Postgres host, e.g. Supabase Storage) for all uploaded media. Uploads flow through signed URLs issued by the platform API — the app server never proxies file bytes directly. Enforce server-side type/size allow-lists before issuing a signed URL (`SECURITY_MODEL.md` "File uploads").

## Consequences
- Phase 9 (Media) implements this from scratch — there is no existing upload code to migrate, only metadata shapes to reuse.
- CMS and product images move from hardcoded external URLs to real managed storage; existing seed/demo image URLs remain valid as fixture data but are not the production path.

## Alternatives considered
- Storing files directly on the app server's filesystem: rejected — doesn't survive redeploys/horizontal scaling and has no CDN characteristics.
- Database BLOB storage: rejected — Postgres is not the right tool for media bytes at any real scale.
