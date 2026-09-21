/**
 * Local-filesystem storage provider (Phase 9 §31 —
 * docs/STORAGE_PROVIDER_ARCHITECTURE.md). Selected only when
 * OBJECT_STORAGE_PROVIDER=none, which `server/config/env.ts` refuses to
 * accept in production/staging — this provider exists purely so a
 * developer can run the app locally without any cloud credentials, never
 * as a production backend.
 *
 * "Signed" URLs here are real HMAC-signed, short-lived, single-purpose
 * tokens (same `signHmac`/`verifyHmacSignature` primitives used for
 * webhook signatures) pointing at two dedicated routes
 * (`server/routes/v1/mediaRoutes.ts`'s `/local-object/*`) that stream
 * bytes to/from `config.localStorageDir` — the same shape of contract a
 * real presigned S3/Supabase URL offers the browser, just served by this
 * process instead of a cloud provider.
 */
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { config } from "../config/env";
import { signHmac, verifyHmacSignature } from "../utils/crypto";
import type { HeadObjectResult, SignedUpload, StorageProvider } from "./types";

const HMAC_DOMAIN = "media-local-storage";

function rootDir(): string {
  return join(process.cwd(), config.localStorageDir);
}

/** Resolves a storage key to an absolute path, refusing to ever resolve outside rootDir (defense in depth — keys are always server-generated, never client paths, but this is cheap insurance). */
function resolvePath(key: string): string {
  const root = rootDir();
  const target = normalize(join(root, key));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Refusing to resolve storage key outside the local storage root: ${key}`);
  }
  return target;
}

export function signLocalStorageToken(action: "upload" | "read", key: string, expiresAt: Date): string {
  return signHmac(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAt.getTime()}`);
}

export function verifyLocalStorageToken(action: "upload" | "read", key: string, expiresAtMs: number, signature: string): boolean {
  if (Date.now() > expiresAtMs) return false;
  return verifyHmacSignature(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAtMs}`, signature);
}

export class LocalFilesystemStorageProvider implements StorageProvider {
  readonly name = "local";

  async createSignedUploadUrl(params: { key: string; contentType: string; maxSizeBytes: number }): Promise<SignedUpload> {
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1000);
    const sig = signLocalStorageToken("upload", params.key, expiresAt);
    const url = `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
    return { url, method: "PUT", headers: { "Content-Type": params.contentType }, expiresAt };
  }

  async createSignedReadUrl(params: { key: string; expiresInSeconds: number }): Promise<string> {
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);
    const sig = signLocalStorageToken("read", params.key, expiresAt);
    return `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const s = await stat(resolvePath(key));
      if (!s.isFile()) return { exists: false };
      return { exists: true, sizeBytes: s.size };
    } catch {
      return { exists: false };
    }
  }

  async readHeadBytes(key: string, byteLength: number): Promise<Buffer> {
    let handle;
    try {
      handle = await open(resolvePath(key), "r");
      const buf = Buffer.alloc(byteLength);
      const { bytesRead } = await handle.read(buf, 0, byteLength, 0);
      return buf.subarray(0, bytesRead);
    } catch {
      return Buffer.alloc(0);
    } finally {
      await handle?.close();
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await rm(resolvePath(key), { force: true });
    } catch {
      // Already gone — deleteObject is idempotent by contract.
    }
  }

  async writeObject(key: string, bytes: Buffer): Promise<void> {
    const path = resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async readObject(key: string): Promise<Buffer> {
    return readFile(resolvePath(key));
  }
}

export const localFilesystemStorageProvider = new LocalFilesystemStorageProvider();
