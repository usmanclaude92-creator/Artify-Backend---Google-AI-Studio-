/**
 * Centralized, validated environment configuration.
 *
 * Nothing else in the codebase should read `process.env` directly (enforced
 * by `no-restricted-syntax`-style review, not yet a lint rule — see
 * docs/SECURITY_CONFIGURATION.md). Every consumer imports `config` from
 * here. The process exits with a clear, non-sensitive error message if
 * required configuration is missing or invalid — it never falls back to a
 * hardcoded secret (that exact pattern — `WEBHOOK_SECRET || "artify_whsec_prod_2026_soc2"`
 * — was Phase 0 finding S3/S4/R3/R4 and must never recur).
 */
import dotenv from "dotenv";
import { z } from "zod";

// No-op in production platforms (Railway/Vercel) that inject real env vars
// directly and have no .env file to find — this only matters for local dev.
dotenv.config();

const KNOWN_COMPROMISED_WEBHOOK_SECRET = "artify_whsec_prod_2026_soc2";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
        message: "DATABASE_URL must be a postgresql:// connection string",
      }),

    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    COOKIE_DOMAIN: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .min(1, "CORS_ORIGINS is required (comma-separated list of allowed origins)")
      .transform((v) =>
        v
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET must be at least 16 characters"),

    AI_PROVIDER: z.enum(["gemini", "none"]).default("gemini"),
    GEMINI_API_KEY: z.string().optional().default(""),

    // Phase 9 — media/object storage provider abstraction
    // (docs/STORAGE_PROVIDER_ARCHITECTURE.md). "none" selects the
    // local-filesystem provider — development/test only, rejected below in
    // production/staging. "s3"/"r2" share one S3-compatible provider
    // implementation; "supabase" uses Supabase Storage (the project's
    // established production target — docs/SUPABASE_DATABASE_SETUP.md).
    OBJECT_STORAGE_PROVIDER: z.enum(["none", "s3", "r2", "supabase"]).default("none"),
    OBJECT_STORAGE_BUCKET: z.string().optional().default(""),
    OBJECT_STORAGE_REGION: z.string().optional().default(""),
    OBJECT_STORAGE_ENDPOINT: z.string().optional().default(""),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional().default(""),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional().default(""),
    OBJECT_STORAGE_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v === "true"),
    SUPABASE_STORAGE_URL: z.string().optional().default(""),
    SUPABASE_STORAGE_SERVICE_ROLE_KEY: z.string().optional().default(""),
    LOCAL_STORAGE_DIR: z.string().optional().default(".local-storage"),

    MEDIA_MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    MEDIA_MAX_DOCUMENT_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
    MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    MEDIA_UPLOAD_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

    // Phase 3 — centralized security tunables (docs/AUTHENTICATION_ARCHITECTURE.md).
    // Never hard-code these values inline in service code; every consumer
    // reads them from `config` here.
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),

    // Phase 6 — client-admin workspace invitations (docs/WORKSPACE_PROVISIONING.md).
    INVITATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),

    // Phase 11 — public website integration (docs/PUBLIC_API_ARCHITECTURE.md).
    // The public website (artifysolscom) has no tenant/session context of
    // its own — every public CMS page/post/lead belongs to exactly one
    // agency organization, resolved here rather than guessed from a
    // caller-supplied value. Left unset, the public CMS/lead endpoints
    // report "not configured" (empty content, lead intake disabled) rather
    // than fabricating or guessing an organization.
    PUBLIC_WEBSITE_ORGANIZATION_ID: z.string().optional().default(""),
  })
  .superRefine((val, ctx) => {
    const isProdLike = val.NODE_ENV === "production" || val.NODE_ENV === "staging";

    if (val.WEBHOOK_SECRET === KNOWN_COMPROMISED_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEBHOOK_SECRET"],
        message:
          "WEBHOOK_SECRET matches the value compromised in the Phase 0 audit (it was hardcoded in source and shipped to the browser). Generate a new secret and rotate it with the webhook provider — never reuse this value.",
      });
    }

    if (isProdLike) {
      if (val.SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SESSION_SECRET"],
          message: "SESSION_SECRET must be at least 32 characters in production/staging",
        });
      }
      if (val.CORS_ORIGINS.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGINS"],
          message: "CORS_ORIGINS must not contain '*' in production/staging — list explicit origins",
        });
      }
      if (val.AI_PROVIDER === "gemini" && !val.GEMINI_API_KEY) {
        // Not fatal: AI features degrade to "unavailable" rather than fail boot.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] AI_PROVIDER=gemini but GEMINI_API_KEY is empty — AI endpoints will report unavailable until it is set."
        );
      }
      if (!val.PUBLIC_WEBSITE_ORGANIZATION_ID) {
        // Not fatal: the public website degrades to empty CMS/product
        // listings and disabled lead intake rather than fail boot or guess
        // a tenant.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] PUBLIC_WEBSITE_ORGANIZATION_ID is empty — public CMS/product content will report empty and public lead intake will be disabled until it is set."
        );
      }

      // The local-filesystem provider ("none") is a development/test
      // convenience only — it must never silently become the production
      // storage backend (Phase 9 §31/§46).
      if (val.OBJECT_STORAGE_PROVIDER === "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OBJECT_STORAGE_PROVIDER"],
          message:
            "OBJECT_STORAGE_PROVIDER must be explicitly configured to a real provider (s3, r2, or supabase) in production/staging — 'none' (local filesystem) is development/test-only.",
        });
      }
    }

    if (val.OBJECT_STORAGE_PROVIDER === "s3" || val.OBJECT_STORAGE_PROVIDER === "r2") {
      if (!val.OBJECT_STORAGE_BUCKET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_BUCKET"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_ACCESS_KEY_ID) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_ACCESS_KEY_ID"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_SECRET_ACCESS_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_SECRET_ACCESS_KEY"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_REGION) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_REGION"], message: "required for the s3/r2 storage provider" });
      if (val.OBJECT_STORAGE_PROVIDER === "r2" && !val.OBJECT_STORAGE_ENDPOINT) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_ENDPOINT"], message: "required for the r2 storage provider (the account's R2 S3 API endpoint)" });
      }
    }

    if (val.OBJECT_STORAGE_PROVIDER === "supabase") {
      if (!val.OBJECT_STORAGE_BUCKET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_BUCKET"], message: "required for the supabase storage provider (the Storage bucket name)" });
      if (!val.SUPABASE_STORAGE_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_URL"], message: "required for the supabase storage provider" });
      if (!val.SUPABASE_STORAGE_SERVICE_ROLE_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_SERVICE_ROLE_KEY"], message: "required for the supabase storage provider — server-side only, never sent to the browser" });
      }
    }
  });

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "staging" | "production";
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  cookieDomain: string | undefined;
  corsOrigins: readonly string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  webhookSecret: string;
  aiProvider: "gemini" | "none";
  geminiApiKey: string;
  objectStorageProvider: "none" | "s3" | "r2" | "supabase";
  objectStorageBucket: string;
  objectStorageRegion: string;
  objectStorageEndpoint: string;
  objectStorageAccessKeyId: string;
  objectStorageSecretAccessKey: string;
  objectStorageForcePathStyle: boolean;
  supabaseStorageUrl: string;
  supabaseStorageServiceRoleKey: string;
  localStorageDir: string;
  mediaMaxImageSizeBytes: number;
  mediaMaxDocumentSizeBytes: number;
  mediaSignedUrlTtlSeconds: number;
  mediaUploadSessionTtlMinutes: number;
  sessionTtlHours: number;
  accountLockoutThreshold: number;
  accountLockoutDurationMinutes: number;
  passwordResetTokenTtlMinutes: number;
  passwordMinLength: number;
  invitationTokenTtlHours: number;
  publicWebsiteOrganizationId: string;
}>;

export type EnvValidationResult =
  | { success: true; config: AppConfig }
  | { success: false; errors: string[] };

/**
 * Pure validation function — no process.exit, no console output. Exported
 * separately so unit tests can exercise every validation branch (missing
 * var, compromised secret reuse, weak prod secret, wildcard CORS in prod)
 * without killing the test process. See tests/unit/config.env.test.ts.
 */
export function validateEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): EnvValidationResult {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }

  const env = parsed.data;

  return {
    success: true,
    config: Object.freeze({
      nodeEnv: env.NODE_ENV,
      isProduction: env.NODE_ENV === "production",
      port: env.PORT,
      databaseUrl: env.DATABASE_URL,
      sessionSecret: env.SESSION_SECRET,
      cookieDomain: env.COOKIE_DOMAIN,
      corsOrigins: env.CORS_ORIGINS,
      logLevel: env.LOG_LEVEL,
      webhookSecret: env.WEBHOOK_SECRET,
      aiProvider: env.AI_PROVIDER,
      geminiApiKey: env.GEMINI_API_KEY,
      objectStorageProvider: env.OBJECT_STORAGE_PROVIDER,
      objectStorageBucket: env.OBJECT_STORAGE_BUCKET,
      objectStorageRegion: env.OBJECT_STORAGE_REGION,
      objectStorageEndpoint: env.OBJECT_STORAGE_ENDPOINT,
      objectStorageAccessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
      objectStorageSecretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      objectStorageForcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      supabaseStorageUrl: env.SUPABASE_STORAGE_URL,
      supabaseStorageServiceRoleKey: env.SUPABASE_STORAGE_SERVICE_ROLE_KEY,
      localStorageDir: env.LOCAL_STORAGE_DIR,
      mediaMaxImageSizeBytes: env.MEDIA_MAX_IMAGE_SIZE_BYTES,
      mediaMaxDocumentSizeBytes: env.MEDIA_MAX_DOCUMENT_SIZE_BYTES,
      mediaSignedUrlTtlSeconds: env.MEDIA_SIGNED_URL_TTL_SECONDS,
      mediaUploadSessionTtlMinutes: env.MEDIA_UPLOAD_SESSION_TTL_MINUTES,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
      accountLockoutDurationMinutes: env.ACCOUNT_LOCKOUT_DURATION_MINUTES,
      passwordResetTokenTtlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      invitationTokenTtlHours: env.INVITATION_TOKEN_TTL_HOURS,
      publicWebsiteOrganizationId: env.PUBLIC_WEBSITE_ORGANIZATION_ID,
    }),
  };
}

function loadConfig(): AppConfig {
  const result = validateEnv(process.env);

  if (!result.success) {
    console.error("FATAL: invalid environment configuration. Refusing to start.\n");
    for (const message of result.errors) {
      console.error(`  - ${message}`);
    }
    // Never print process.env here — it may contain partially-set secrets.
    process.exit(1);
  }

  return result.config;
}

export const config: AppConfig = loadConfig();
