/**
 * Centralized media allowlist + magic-byte verification (Phase 9 §7/§8 —
 * docs/MEDIA_ARCHITECTURE.md). Never trust a claimed Content-Type or a
 * filename extension alone — every upload's first bytes are checked
 * against the signature for its claimed MIME type before the media row is
 * marked ACTIVE (server/services/mediaService.ts's completeUpload).
 */

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"] as const;
export const ALLOWED_DOCUMENT_MIME_TYPES = ["application/pdf"] as const;
export const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_DOCUMENT_MIME_TYPES] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isImageMimeType(mimeType: string): boolean {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function mediaCategoryFor(mimeType: string): "image" | "document" {
  return isImageMimeType(mimeType) ? "image" : "document";
}

const EXTENSION_BY_MIME: Record<AllowedMimeType, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"],
};

export function extensionMatchesMimeType(filename: string, mimeType: AllowedMimeType): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return EXTENSION_BY_MIME[mimeType].includes(ext);
}

/**
 * Verifies the first bytes of an object against the magic number/signature
 * expected for the claimed MIME type. SVG has no binary magic number (it's
 * XML text) — checked separately by content shape rather than a byte
 * prefix. Returns false (never throws) for anything that doesn't match,
 * including a too-short buffer.
 */
export function verifyFileSignature(mimeType: AllowedMimeType, head: Buffer): boolean {
  if (mimeType === "image/svg+xml") {
    const text = head.toString("utf8", 0, Math.min(head.length, 512)).trimStart().toLowerCase();
    return text.startsWith("<?xml") || text.startsWith("<svg");
  }
  if (mimeType === "image/webp") return isValidWebp(head);

  const sig = SIGNATURES[mimeType];
  if (!sig) return false;
  return sig.some((candidate) => head.length >= candidate.length && candidate.every((byte, i) => head[i] === byte));
}

const SIGNATURES: Partial<Record<AllowedMimeType, number[][]>> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
};

/** WEBP is "RIFF"<4-byte size>"WEBP" — the plain RIFF prefix alone is shared with WAV/AVI, so bytes 8-11 must also be checked. */
function isValidWebp(head: Buffer): boolean {
  if (head.length < 12) return false;
  return head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head.subarray(8, 12).toString("ascii") === "WEBP";
}
