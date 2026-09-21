/**
 * S3-compatible storage provider (Phase 9 — docs/STORAGE_PROVIDER_ARCHITECTURE.md).
 * Backs both OBJECT_STORAGE_PROVIDER=s3 (AWS S3) and =r2 (Cloudflare R2,
 * which exposes an S3-compatible API) — one implementation, since R2's
 * only real difference is a custom endpoint + path-style addressing, both
 * already configurable via OBJECT_STORAGE_ENDPOINT/OBJECT_STORAGE_FORCE_PATH_STYLE.
 * Not live-verified from this build's sandbox (no outbound network to a
 * real bucket) — implementation is complete and exercised through
 * `TestStorageProvider` in every automated test (Phase 9 §32).
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/env";
import type { HeadObjectResult, SignedUpload, StorageProvider } from "./types";

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.objectStorageRegion || "auto",
      endpoint: config.objectStorageEndpoint || undefined,
      forcePathStyle: config.objectStorageForcePathStyle,
      credentials: { accessKeyId: config.objectStorageAccessKeyId, secretAccessKey: config.objectStorageSecretAccessKey },
    });
  }
  return client;
}

export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = config.objectStorageProvider === "r2" ? "r2" : "s3";

  async createSignedUploadUrl(params: { key: string; contentType: string; maxSizeBytes: number }): Promise<SignedUpload> {
    const command = new PutObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key, ContentType: params.contentType });
    const url = await getSignedUrl(getClient(), command, { expiresIn: config.mediaSignedUrlTtlSeconds });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1000),
    };
  }

  async createSignedReadUrl(params: { key: string; expiresInSeconds: number }): Promise<string> {
    const command = new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key });
    return getSignedUrl(getClient(), command, { expiresIn: params.expiresInSeconds });
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    try {
      const res = await getClient().send(new HeadObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
      return { exists: true, sizeBytes: res.ContentLength, contentType: res.ContentType };
    } catch {
      return { exists: false };
    }
  }

  async readHeadBytes(key: string, byteLength: number): Promise<Buffer> {
    try {
      const res = await getClient().send(
        new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: key, Range: `bytes=0-${byteLength - 1}` })
      );
      if (!res.Body) return Buffer.alloc(0);
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return Buffer.alloc(0);
    }
  }

  async deleteObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
  }
}

export const s3CompatibleStorageProvider = new S3CompatibleStorageProvider();
