/**
 * Safe, collision-resistant storage key generation (Phase 9 §10 —
 * docs/MEDIA_ARCHITECTURE.md). A storage key is never built from a
 * caller-supplied path — only from server-generated ids plus a sanitized
 * version of the original filename, so there is no path-traversal, no
 * cross-organization key collision, and no way for a client to name an
 * arbitrary key.
 */

/** Strips everything except ASCII letters/digits/dot/hyphen/underscore, collapses repeats, caps length. Never returns "." or ".." alone. */
export function sanitizeFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? "file";
  let safe = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9.\-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, 150);
  if (!safe || safe === "." || safe === "..") safe = "file";
  return safe;
}

/**
 * `organizations/{organizationId}/media/{mediaId}/{safeFilename}` — the
 * mediaId segment alone already guarantees collision-resistance (it's a
 * fresh UUID per upload), the organizationId prefix keeps every object
 * physically partitioned per tenant, and the filename is sanitized only
 * for readability in a storage browser, never trusted for anything else.
 */
export function buildStorageKey(organizationId: string, mediaId: string, originalFilename: string): string {
  return `organizations/${organizationId}/media/${mediaId}/${sanitizeFilename(originalFilename)}`;
}
