/**
 * Storage provider factory (Phase 9 — docs/STORAGE_PROVIDER_ARCHITECTURE.md).
 * The single place that decides which `StorageProvider` implementation is
 * live — mediaService and mediaRoutes call `getStorageProvider()` and
 * never import a concrete provider class directly. `NODE_ENV=test` always
 * gets the deterministic in-memory provider, regardless of
 * OBJECT_STORAGE_PROVIDER, so no test requires live cloud credentials
 * (Phase 9 §32) — this mirrors `tests/helpers/db.ts`'s NODE_ENV-gated
 * test-database isolation.
 */
import { config } from "../config/env";
import { localFilesystemStorageProvider } from "./localFilesystemProvider";
import { s3CompatibleStorageProvider } from "./s3CompatibleProvider";
import { supabaseStorageProvider } from "./supabaseStorageProvider";
import { testStorageProvider } from "./testStorageProvider";
import type { StorageProvider } from "./types";

export function getStorageProvider(): StorageProvider {
  if (config.nodeEnv === "test") return testStorageProvider;

  switch (config.objectStorageProvider) {
    case "supabase":
      return supabaseStorageProvider;
    case "s3":
    case "r2":
      return s3CompatibleStorageProvider;
    case "none":
    default:
      return localFilesystemStorageProvider;
  }
}

export type { HeadObjectResult, SignedUpload, StorageProvider } from "./types";
