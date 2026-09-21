/** Phase 9 §32/§33 — TestStorageProvider contract + magic-byte signature verification, no live credentials required. */
import { describe, expect, it, beforeEach } from "vitest";
import { TestStorageProvider } from "../../server/storage/testStorageProvider";
import { verifyFileSignature, extensionMatchesMimeType, isImageMimeType, mediaCategoryFor, isAllowedMimeType } from "../../server/utils/fileSignature";
import { sanitizeFilename, buildStorageKey } from "../../server/utils/storageKey";

describe("TestStorageProvider", () => {
  let provider: TestStorageProvider;

  beforeEach(() => {
    provider = new TestStorageProvider();
  });

  it("creates a signed upload URL with an expiry in the future", async () => {
    const upload = await provider.createSignedUploadUrl({ key: "orgs/1/media/2/file.png", contentType: "image/png", maxSizeBytes: 1000 });
    expect(upload.method).toBe("PUT");
    expect(upload.url).toContain("file.png");
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("reports an object as missing before it's seeded, and present after", async () => {
    const key = "orgs/1/media/2/file.png";
    expect((await provider.headObject(key)).exists).toBe(false);
    provider.seedObject(key, Buffer.from([1, 2, 3]), "image/png");
    const head = await provider.headObject(key);
    expect(head.exists).toBe(true);
    expect(head.sizeBytes).toBe(3);
  });

  it("readHeadBytes returns an empty buffer for a missing object, never throws", async () => {
    const bytes = await provider.readHeadBytes("nonexistent-key", 16);
    expect(bytes.length).toBe(0);
  });

  it("simulates an object that never arrived (abandoned upload) via missingKeys, even after seeding", async () => {
    const key = "orgs/1/media/2/file.png";
    provider.seedObject(key, Buffer.from([1, 2, 3]), "image/png");
    provider.missingKeys.add(key);
    expect((await provider.headObject(key)).exists).toBe(false);
  });

  it("delete is idempotent — deleting twice never throws", async () => {
    const key = "orgs/1/media/2/file.png";
    provider.seedObject(key, Buffer.from([1]), "image/png");
    await provider.deleteObject(key);
    await expect(provider.deleteObject(key)).resolves.toBeUndefined();
  });

  it("reset() clears all seeded objects", async () => {
    const key = "orgs/1/media/2/file.png";
    provider.seedObject(key, Buffer.from([1]), "image/png");
    provider.reset();
    expect((await provider.headObject(key)).exists).toBe(false);
  });
});

describe("file signature verification", () => {
  it("accepts a real JPEG magic number", () => {
    expect(verifyFileSignature("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("accepts a real PNG magic number", () => {
    expect(verifyFileSignature("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("accepts a real WEBP (RIFF....WEBP) signature", () => {
    const head = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);
    expect(verifyFileSignature("image/webp", head)).toBe(true);
  });

  it("rejects a plain RIFF/WAV file declared as WEBP (shared RIFF prefix, different fourCC)", () => {
    const head = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]), Buffer.from("WAVE", "ascii")]);
    expect(verifyFileSignature("image/webp", head)).toBe(false);
  });

  it("accepts a real PDF signature", () => {
    expect(verifyFileSignature("application/pdf", Buffer.from("%PDF-1.4"))).toBe(true);
  });

  it("accepts a real SVG's XML/svg prefix", () => {
    expect(verifyFileSignature("image/svg+xml", Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe(true);
    expect(verifyFileSignature("image/svg+xml", Buffer.from("<svg xmlns='...'></svg>"))).toBe(true);
  });

  it("rejects an executable (MZ header) masquerading as a PNG — the exact attack this check exists for", () => {
    const exeHead = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(verifyFileSignature("image/png", exeHead)).toBe(false);
  });

  it("rejects a script masquerading as a PDF", () => {
    expect(verifyFileSignature("application/pdf", Buffer.from("#!/bin/sh\nrm -rf /"))).toBe(false);
  });

  it("rejects a too-short buffer instead of throwing", () => {
    expect(verifyFileSignature("image/png", Buffer.from([0x89]))).toBe(false);
  });
});

describe("MIME allowlist helpers", () => {
  it("accepts every documented image/document type and rejects an arbitrary one", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("application/pdf")).toBe(true);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
    expect(isAllowedMimeType("text/html")).toBe(false);
  });

  it("classifies images vs documents correctly", () => {
    expect(isImageMimeType("image/jpeg")).toBe(true);
    expect(isImageMimeType("application/pdf")).toBe(false);
    expect(mediaCategoryFor("image/jpeg")).toBe("image");
    expect(mediaCategoryFor("application/pdf")).toBe("document");
  });

  it("validates a filename's extension against its claimed MIME type", () => {
    expect(extensionMatchesMimeType("photo.jpg", "image/jpeg")).toBe(true);
    expect(extensionMatchesMimeType("photo.png", "image/jpeg")).toBe(false);
    expect(extensionMatchesMimeType("noextension", "image/jpeg")).toBe(false);
  });
});

describe("storage key generation", () => {
  it("sanitizes a filename to safe characters only", () => {
    expect(sanitizeFilename("My Photo (final) v2.jpg")).toMatch(/^[a-zA-Z0-9.\-_]+$/);
  });

  it("strips path separators — never lets a filename escape into a directory traversal", () => {
    const sanitized = sanitizeFilename("../../etc/passwd");
    expect(sanitized).not.toContain("/");
    expect(sanitized).not.toContain("..");
  });

  it("strips a Windows-style path down to just the basename", () => {
    const sanitized = sanitizeFilename("C:\\Users\\evil\\..\\..\\secret.txt");
    expect(sanitized).not.toContain("\\");
    expect(sanitized).not.toContain("..");
  });

  it("builds a collision-resistant, organization-partitioned key", () => {
    const key = buildStorageKey("org-1", "media-1", "photo.jpg");
    expect(key).toBe("organizations/org-1/media/media-1/photo.jpg");
  });

  it("never lets a caller-supplied filename inject a different organization/media path segment", () => {
    const key = buildStorageKey("org-1", "media-1", "../../org-2/media/media-2/hijacked.jpg");
    expect(key.startsWith("organizations/org-1/media/media-1/")).toBe(true);
    expect(key).not.toContain("org-2");
  });
});
