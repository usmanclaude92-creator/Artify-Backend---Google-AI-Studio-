/**
 * Vercel serverless entry point (source). server.ts's single-process
 * topology (Express app + static frontend serving + .listen()) targets
 * Railway/Docker; Vercel instead serves the Vite build output as static
 * files and needs the API surface as a function it can invoke per
 * request. Re-uses the exact same `createApp()`/`finalizeApp()` assembly
 * server.ts uses — no route/middleware duplication.
 *
 * This file is NOT deployed as-is. Vercel's Node.js builder only compiles
 * the single file it finds under `/api` — it does not bundle files that
 * file imports from elsewhere in the repo (confirmed: an earlier version
 * of this handler living directly at api/index.ts crashed every request
 * with `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/server/app/app'`,
 * since `server/` never made it into the deployed function). The build
 * step (see package.json's "build:vercel-api" script, wired into
 * buildCommand in vercel.json's sibling config) bundles this file with
 * esbuild into a single self-contained api/index.mjs — the same
 * `--bundle` technique server.ts already uses to produce dist/server.cjs
 * for the Railway/Docker deployment.
 */
import { createApp, finalizeApp } from "./app/app";

const app = createApp();
finalizeApp(app);

export default app;
