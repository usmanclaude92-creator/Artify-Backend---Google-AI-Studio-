# Storage Provider Architecture (Phase 9)

## The abstraction

`server/storage/types.ts` defines the one interface every provider implements and every consumer (`mediaService.ts`, `mediaRoutes.ts`) depends on:

```ts
interface StorageProvider {
  readonly name: string;
  createSignedUploadUrl(params: { key; contentType; maxSizeBytes }): Promise<SignedUpload>;
  createSignedReadUrl(params: { key; expiresInSeconds }): Promise<string>;
  headObject(key): Promise<HeadObjectResult>;
  readHeadBytes(key, byteLength): Promise<Buffer>;
  deleteObject(key): Promise<void>;
}
```

```
mediaService.ts
     ↓ depends only on StorageProvider
server/storage/index.ts (getStorageProvider())
     ↓ picks the implementation by config.objectStorageProvider
LocalFilesystemStorageProvider | SupabaseStorageProvider | S3CompatibleStorageProvider | TestStorageProvider
```

No AWS/Supabase SDK type or call appears anywhere outside `server/storage/*.ts`. Switching `OBJECT_STORAGE_PROVIDER` changes which class the factory returns and nothing else — `mediaService.ts` was written once, against the interface, before any provider's real implementation existed.

## Providers

| `OBJECT_STORAGE_PROVIDER` | Implementation | When it's used |
|---|---|---|
| `none` | `LocalFilesystemStorageProvider` | Local development only — **rejected at startup in production/staging** (`server/config/env.ts`'s `superRefine`). |
| `s3` / `r2` | `S3CompatibleStorageProvider` | One implementation backs both — Cloudflare R2 exposes an S3-compatible API; the only real differences are `OBJECT_STORAGE_ENDPOINT` (required for r2) and `OBJECT_STORAGE_FORCE_PATH_STYLE`. Uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. |
| `supabase` | `SupabaseStorageProvider` | The established production target for this project — Postgres is already Supabase-designated (`docs/SUPABASE_DATABASE_SETUP.md`), this is the matching Storage implementation. Uses `@supabase/supabase-js`'s storage client with the service-role key. |
| *(always, when `NODE_ENV=test`)* | `TestStorageProvider` | In-memory, deterministic, no network — see below. Selected regardless of `OBJECT_STORAGE_PROVIDER`, the same way `tests/helpers/db.ts` always points at a `test`-marked database regardless of what `.env` says. |

Per the brief's explicit "do not add multiple storage providers unnecessarily," only these are implemented — not a fourth GCS/Azure provider nobody asked for. Both real cloud providers are genuinely complete implementations, not stubs; **neither has been exercised against a live bucket from this build's execution sandbox** — the same environmental network limitation documented for Postgres since Phase 2 (no outbound path to Supabase or AWS from here). Every application code path that touches a `StorageProvider` is fully exercised through `TestStorageProvider` in the automated suite instead (Phase 9 §32/§46).

## Local development: the filesystem provider

`LocalFilesystemStorageProvider` writes objects under `config.localStorageDir` (default `.local-storage/`, gitignored). Its "signed URLs" are real, not fake — genuine HMAC-signed, short-lived, single-purpose tokens (`signLocalStorageToken`/`verifyLocalStorageToken` in `server/storage/localFilesystemProvider.ts`, using the same `signHmac`/`verifyHmacSignature` primitives as webhook signatures) pointing at two dedicated routes mounted **before** `authenticateToken` in `mediaRoutes.ts`:

- `PUT /api/v1/media/local-object?key=&exp=&sig=` — receives the raw bytes via `express.raw({ type: () => true })`, scoped to just this route (the global body parser only handles `application/json`/`application/x-www-form-urlencoded`, so it never touches a binary PUT).
- `GET /api/v1/media/local-object?key=&exp=&sig=` — streams the bytes back.

These routes are unauthenticated by session cookie on purpose — a real presigned S3/Supabase URL isn't authorized by a session cookie either, only by its own signature. Both routes 404 immediately unless the local provider is actually selected (`getStorageProvider().name !== "local"`), so they are inert in every other configuration. **This provider is never a production backend** — `server/config/env.ts` refuses to boot with `OBJECT_STORAGE_PROVIDER=none` when `NODE_ENV` is `production` or `staging`.

## Test provider

`TestStorageProvider` (`server/storage/testStorageProvider.ts`) is a module-singleton in-memory `Map<key, {bytes, contentType}>`, reset by `tests/helpers/db.ts`'s `resetDb()` alongside the database between tests. It implements the full interface faithfully enough to exercise real `mediaService` logic — not a mock that always succeeds:

- `seedObject(key, bytes, contentType)` — test helper simulating the browser's PUT to the signed URL completing.
- `missingKeys` — a set of keys that report as absent even if seeded, simulating an abandoned upload (§20).
- `headObject`/`readHeadBytes` return real size/content-type/byte data from what was actually seeded, so `mediaService.completeUpload`'s magic-byte verification and size checks run against genuine (if synthetic) bytes, not a stub that always passes.

No test in this repository requires a live AWS or Supabase credential.

## Storage key design (§10)

`server/utils/storageKey.ts`: `organizations/{organizationId}/media/{mediaId}/{safeFilename}`. `mediaId` is a fresh UUID generated server-side before the key is built (`randomUUID()` in `mediaService.createUploadSession`, passed explicitly into `mediaRepository.create`) — it alone already guarantees collision-resistance; the `organizationId` prefix physically partitions every tenant's objects; `safeFilename` (`sanitizeFilename`) strips everything but ASCII letters/digits/`.`/`-`/`_`, collapses repeats, and caps length — a filename can never inject a path separator, `..`, or escape its own `{organizationId}/{mediaId}/` segment, verified directly in `tests/unit/storageProvider.test.ts` ("never lets a caller-supplied filename inject a different organization/media path segment") and via the API in `tests/integration/mediaSecurity.test.ts`. No endpoint accepts a caller-supplied storage key, bucket, or container at all — the key is 100% server-generated, every time.

## Credential isolation (§3)

`OBJECT_STORAGE_ACCESS_KEY_ID`/`OBJECT_STORAGE_SECRET_ACCESS_KEY`/`SUPABASE_STORAGE_SERVICE_ROLE_KEY` are read once, server-side, by `server/config/env.ts`'s validated schema — the same module that already refuses to boot with a missing/compromised `WEBHOOK_SECRET`/`SESSION_SECRET`. They are used only inside `s3CompatibleProvider.ts`/`supabaseStorageProvider.ts`, never serialized into an API response, never placed in a `VITE_`-prefixed variable (which Vite would inline into the browser bundle), and grepped for on every phase's security sweep. The browser only ever receives a short-lived signed URL (`MEDIA_SIGNED_URL_TTL_SECONDS`, default 15 minutes) or a short-lived upload-session bearer token (`MEDIA_UPLOAD_SESSION_TTL_MINUTES`, default 15 minutes, hashed at rest) — never a reusable, permanently-privileged credential.
