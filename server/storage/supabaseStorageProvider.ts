/**
 * Supabase Storage provider (Phase 9 — docs/STORAGE_PROVIDER_ARCHITECTURE.md).
 * The established production target for this project (Postgres is already
 * Supabase-designated — docs/SUPABASE_DATABASE_SETUP.md); this is the
 * matching Storage implementation. Uses the service-role key, which never
 * leaves this server process — it is read once from validated
 * server-side config (server/config/env.ts) and used only inside this
 * file's `supabase-js` client.
 *
 * Live connectivity from this build's execution sandbox is unverified —
 * the same environmental network limitation documented for Postgres since
 * Phase 2 (docs/SUPABASE_DATABASE_SETUP.md's "Known limitation"). The
 * implementation itself is complete and exercised through
 * `TestStorageProvider` in every automated test (Phase 9 §32).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/env";
import type { HeadObjectResult, SignedUpload, StorageProvider } from "./types";

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseStorageUrl, config.supabaseStorageServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";

  async createSignedUploadUrl(params: { key: string; contentType: string }): Promise<SignedUpload> {
    const { data, error } = await getClient().storage.from(config.objectStorageBucket).createSignedUploadUrl(params.key);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed upload URL (${error?.message ?? "unknown error"})`);

    return {
      url: `${config.supabaseStorageUrl}/storage/v1${data.signedUrl.startsWith("/") ? "" : "/"}${data.signedUrl}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1000),
    };
  }

  async createSignedReadUrl(params: { key: string; expiresInSeconds: number }): Promise<string> {
    const { data, error } = await getClient().storage.from(config.objectStorageBucket).createSignedUrl(params.key, params.expiresInSeconds);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed read URL (${error?.message ?? "unknown error"})`);
    return data.signedUrl;
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const { data, error } = await getClient().storage.from(config.objectStorageBucket).list(dir, { search: name, limit: 1 });
    if (error || !data || data.length === 0) return { exists: false };
    const found = data.find((f) => f.name === name);
    if (!found) return { exists: false };
    return { exists: true, sizeBytes: found.metadata?.size as number | undefined, contentType: found.metadata?.mimetype as string | undefined };
  }

  async readHeadBytes(key: string, byteLength: number): Promise<Buffer> {
    const { data, error } = await getClient().storage.from(config.objectStorageBucket).download(key, { transform: undefined });
    if (error || !data) return Buffer.alloc(0);
    const arrayBuffer = await data.slice(0, byteLength).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteObject(key: string): Promise<void> {
    const { error } = await getClient().storage.from(config.objectStorageBucket).remove([key]);
    // Idempotent by contract — a "not found" style error on delete is not a failure.
    if (error && !/not.*found/i.test(error.message)) throw new Error(`Supabase Storage: delete failed (${error.message})`);
  }
}

export const supabaseStorageProvider = new SupabaseStorageProvider();
