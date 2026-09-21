import { defineConfig } from "vitest/config";

// Separate from vitest.config.ts (server tests are Node-environment,
// share a real Postgres instance, run serially). Frontend tests are
// pure jsdom component/unit tests with no database dependency — kept in
// their own config/command (`npm run test:frontend`) so the two suites
// never interfere with each other's environment or parallelism settings.
// No @vitejs/plugin-react needed: esbuild's built-in JSX transform
// (driven by tsconfig.json's "jsx": "react-jsx") is sufficient for tests,
// and importing the plugin here pulls in a second, incompatible copy of
// Vite's plugin types via vitest's own bundled Vite dependency.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/testSetup.ts"],
  },
});
