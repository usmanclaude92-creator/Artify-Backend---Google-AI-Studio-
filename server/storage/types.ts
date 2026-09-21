/**
 * Storage provider abstraction (Phase 9 §4 — docs/STORAGE_PROVIDER_ARCHITECTURE.md).
 * mediaService depends only on this interface, never on an AWS/Supabase
 * SDK directly — swapping OBJECT_STORAGE_PROVIDER changes which class
 * `getStorageProvider()` returns and nothing else.
 */

export interface SignedUpload {
  url: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  expiresAt: Date;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
}

export interface StorageProvider {
  /** Matches the persisted `MediaAsset.storageProvider` value for assets uploaded through this provider. */
  readonly name: string;

  /** A short-lived, scoped URL the browser uploads directly to — no permanent credential ever reaches the client. */
  createSignedUploadUrl(params: { key: string; contentType: string; maxSizeBytes: number }): Promise<SignedUpload>;

  /** A short-lived, scoped URL for reading a private object — never a permanent public link. */
  createSignedReadUrl(params: { key: string; expiresInSeconds: number }): Promise<string>;

  /** Server-side existence + size/type check — the only source of truth for "did the upload really happen," never the client's own claim. */
  headObject(key: string): Promise<HeadObjectResult>;

  /** Reads the first `byteLength` bytes of an object, for magic-byte signature verification. Returns an empty buffer if the object doesn't exist. */
  readHeadBytes(key: string, byteLength: number): Promise<Buffer>;

  deleteObject(key: string): Promise<void>;
}
