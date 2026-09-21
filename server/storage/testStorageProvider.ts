/**
 * Deterministic in-memory storage provider (Phase 9 §32 —
 * docs/STORAGE_PROVIDER_ARCHITECTURE.md). Used automatically whenever
 * `NODE_ENV=test` (see `server/storage/index.ts`), regardless of
 * OBJECT_STORAGE_PROVIDER — no test in this repo requires live AWS/
 * Supabase credentials. Exercises the exact same interface real providers
 * implement, so mediaService's logic is genuinely tested, not mocked
 * around.
 */
import type { HeadObjectResult, SignedUpload, StorageProvider } from "./types";

interface StoredObject {
  bytes: Buffer;
  contentType: string;
}

export class TestStorageProvider implements StorageProvider {
  readonly name = "test";
  private readonly objects = new Map<string, StoredObject>();
  /** Test-only hook: keys in this set report `headObject`/`readHeadBytes` as if the object never arrived — simulates an abandoned/failed upload (§20 orphan handling). */
  readonly missingKeys = new Set<string>();

  /** Test helper — simulates the browser's PUT to the signed URL succeeding, without a real HTTP round-trip. */
  seedObject(key: string, bytes: Buffer, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  reset(): void {
    this.objects.clear();
    this.missingKeys.clear();
  }

  async createSignedUploadUrl(params: { key: string; contentType: string; maxSizeBytes: number }): Promise<SignedUpload> {
    return {
      url: `https://test-storage.invalid/upload/${encodeURIComponent(params.key)}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  async createSignedReadUrl(params: { key: string; expiresInSeconds: number }): Promise<string> {
    return `https://test-storage.invalid/read/${encodeURIComponent(params.key)}?exp=${Date.now() + params.expiresInSeconds * 1000}`;
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    if (this.missingKeys.has(key)) return { exists: false };
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return { exists: true, sizeBytes: obj.bytes.length, contentType: obj.contentType };
  }

  async readHeadBytes(key: string, byteLength: number): Promise<Buffer> {
    if (this.missingKeys.has(key)) return Buffer.alloc(0);
    const obj = this.objects.get(key);
    if (!obj) return Buffer.alloc(0);
    return obj.bytes.subarray(0, byteLength);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** Module-singleton so every repository/service call within one test process shares the same in-memory store, matching how a real provider is one shared backend. */
export const testStorageProvider = new TestStorageProvider();
