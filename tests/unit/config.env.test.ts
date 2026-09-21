import { describe, expect, it } from "vitest";
import { validateEnv } from "../../server/config/env";

const VALID_BASE = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: "a".repeat(20),
  CORS_ORIGINS: "http://localhost:3000",
  LOG_LEVEL: "info",
  WEBHOOK_SECRET: "b".repeat(20),
};

const VALID_PROD_STORAGE = {
  OBJECT_STORAGE_PROVIDER: "supabase",
  OBJECT_STORAGE_BUCKET: "media",
  SUPABASE_STORAGE_URL: "https://example.supabase.co",
  SUPABASE_STORAGE_SERVICE_ROLE_KEY: "service-role-key",
};

describe("validateEnv", () => {
  it("accepts a fully valid development configuration", () => {
    const result = validateEnv(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.nodeEnv).toBe("development");
      expect(result.config.corsOrigins).toEqual(["http://localhost:3000"]);
    }
  });

  it("fails fast when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_BASE;
    const result = validateEnv(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
    }
  });

  it("rejects a DATABASE_URL that isn't a postgresql:// connection string", () => {
    const result = validateEnv({ ...VALID_BASE, DATABASE_URL: "mysql://user:pass@localhost/db" });
    expect(result.success).toBe(false);
  });

  it("rejects the known-compromised webhook secret from the Phase 0 audit (S3/S4/R3/R4)", () => {
    const result = validateEnv({ ...VALID_BASE, WEBHOOK_SECRET: "artify_whsec_prod_2026_soc2" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.toLowerCase().includes("compromised"))).toBe(true);
    }
  });

  it("requires a >=32-char SESSION_SECRET in production", () => {
    const result = validateEnv({ ...VALID_BASE, NODE_ENV: "production", SESSION_SECRET: "short-secret-16c" });
    expect(result.success).toBe(false);
  });

  it("accepts a >=32-char SESSION_SECRET in production", () => {
    const result = validateEnv({ ...VALID_BASE, ...VALID_PROD_STORAGE, NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) });
    expect(result.success).toBe(true);
  });

  it("rejects a wildcard CORS origin in production", () => {
    const result = validateEnv({
      ...VALID_BASE,
      ...VALID_PROD_STORAGE,
      NODE_ENV: "production",
      SESSION_SECRET: "x".repeat(32),
      CORS_ORIGINS: "*",
    });
    expect(result.success).toBe(false);
  });

  it("rejects OBJECT_STORAGE_PROVIDER=none (local filesystem) in production — it is development/test-only", () => {
    const result = validateEnv({ ...VALID_BASE, NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("OBJECT_STORAGE_PROVIDER"))).toBe(true);
    }
  });

  it("accepts OBJECT_STORAGE_PROVIDER=none in development — the local-filesystem provider is fine outside production/staging", () => {
    const result = validateEnv({ ...VALID_BASE, NODE_ENV: "development" });
    expect(result.success).toBe(true);
  });

  it("requires s3/r2 credentials when OBJECT_STORAGE_PROVIDER=s3", () => {
    const result = validateEnv({ ...VALID_BASE, OBJECT_STORAGE_PROVIDER: "s3" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("OBJECT_STORAGE_BUCKET"))).toBe(true);
      expect(result.errors.some((e) => e.includes("OBJECT_STORAGE_ACCESS_KEY_ID"))).toBe(true);
    }
  });

  it("requires OBJECT_STORAGE_ENDPOINT specifically for r2 (not required for s3)", () => {
    const s3Result = validateEnv({
      ...VALID_BASE,
      OBJECT_STORAGE_PROVIDER: "s3",
      OBJECT_STORAGE_BUCKET: "b",
      OBJECT_STORAGE_ACCESS_KEY_ID: "k",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "s",
      OBJECT_STORAGE_REGION: "us-east-1",
    });
    expect(s3Result.success).toBe(true);

    const r2Result = validateEnv({
      ...VALID_BASE,
      OBJECT_STORAGE_PROVIDER: "r2",
      OBJECT_STORAGE_BUCKET: "b",
      OBJECT_STORAGE_ACCESS_KEY_ID: "k",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "s",
      OBJECT_STORAGE_REGION: "auto",
    });
    expect(r2Result.success).toBe(false);
    if (!r2Result.success) {
      expect(r2Result.errors.some((e) => e.includes("OBJECT_STORAGE_ENDPOINT"))).toBe(true);
    }
  });

  it("requires Supabase Storage credentials when OBJECT_STORAGE_PROVIDER=supabase", () => {
    const result = validateEnv({ ...VALID_BASE, OBJECT_STORAGE_PROVIDER: "supabase" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("SUPABASE_STORAGE_URL"))).toBe(true);
      expect(result.errors.some((e) => e.includes("SUPABASE_STORAGE_SERVICE_ROLE_KEY"))).toBe(true);
    }
  });

  it("accepts a fully configured Supabase Storage provider", () => {
    const result = validateEnv({ ...VALID_BASE, ...VALID_PROD_STORAGE });
    expect(result.success).toBe(true);
  });

  it("does not fail on a missing GEMINI_API_KEY — AI degrades to unavailable instead", () => {
    const result = validateEnv({ ...VALID_BASE, AI_PROVIDER: "gemini", GEMINI_API_KEY: "" });
    expect(result.success).toBe(true);
  });

  it("never echoes raw process.env or secret values in its error list", () => {
    const result = validateEnv({ ...VALID_BASE, DATABASE_URL: undefined, SESSION_SECRET: "super-secret-value-should-not-leak-0000" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const joined = result.errors.join(" ");
      expect(joined).not.toContain("super-secret-value-should-not-leak");
    }
  });
});
