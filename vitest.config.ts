import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Loaded here — vitest.config.ts runs in Node BEFORE any test file or
// setupFile is imported — deliberately, not in tests/setup.ts. ES module
// `import` statements are hoisted above other top-level code, so a
// dotenv call inside a setupFile that also (transitively) imports
// server/config/env.ts loses the race: that module's own bare
// dotenv.config() (loading plain .env) would evaluate first and freeze
// the wrong DATABASE_URL into its exported `config` constant before the
// setupFile's own dotenv call ever ran. Loading it here, in the config
// file Vitest itself executes first, avoids the hoisting race entirely.
dotenv.config({ path: ".env.test", override: true });

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Integration/security tests share one real Postgres instance
    // (DATABASE_URL from .env.test) — run serially to avoid cross-test
    // interference on shared tables.
    fileParallelism: false,
  },
});
