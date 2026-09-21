// server/app/app.ts
import express3 from "express";

// server/middleware/requestId.ts
import { randomUUID } from "node:crypto";
var REQUEST_ID_HEADER = "x-request-id";
var MAX_INCOMING_ID_LENGTH = 128;
function isSafeIncomingId(value) {
  return value.length > 0 && value.length <= MAX_INCOMING_ID_LENGTH && /^[A-Za-z0-9_.-]+$/.test(value);
}
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = incomingValue && isSafeIncomingId(incomingValue) ? incomingValue : randomUUID();
  req.requestId = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

// server/middleware/security.ts
import cors from "cors";
import helmet from "helmet";
import express from "express";

// server/config/env.ts
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();
var KNOWN_COMPROMISED_WEBHOOK_SECRET = "artify_whsec_prod_2026_soc2";
var envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3e3),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
    message: "DATABASE_URL must be a postgresql:// connection string"
  }),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS is required (comma-separated list of allowed origins)").transform(
    (v) => v.split(",").map((origin) => origin.trim()).filter(Boolean)
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
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.string().optional().default("false").transform((v) => v === "true"),
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
  PUBLIC_WEBSITE_ORGANIZATION_ID: z.string().optional().default("")
}).superRefine((val, ctx) => {
  const isProdLike = val.NODE_ENV === "production" || val.NODE_ENV === "staging";
  if (val.WEBHOOK_SECRET === KNOWN_COMPROMISED_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEBHOOK_SECRET"],
      message: "WEBHOOK_SECRET matches the value compromised in the Phase 0 audit (it was hardcoded in source and shipped to the browser). Generate a new secret and rotate it with the webhook provider \u2014 never reuse this value."
    });
  }
  if (isProdLike) {
    if (val.SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters in production/staging"
      });
    }
    if (val.CORS_ORIGINS.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS must not contain '*' in production/staging \u2014 list explicit origins"
      });
    }
    if (val.AI_PROVIDER === "gemini" && !val.GEMINI_API_KEY) {
      console.warn(
        "[config] AI_PROVIDER=gemini but GEMINI_API_KEY is empty \u2014 AI endpoints will report unavailable until it is set."
      );
    }
    if (!val.PUBLIC_WEBSITE_ORGANIZATION_ID) {
      console.warn(
        "[config] PUBLIC_WEBSITE_ORGANIZATION_ID is empty \u2014 public CMS/product content will report empty and public lead intake will be disabled until it is set."
      );
    }
    if (val.OBJECT_STORAGE_PROVIDER === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OBJECT_STORAGE_PROVIDER"],
        message: "OBJECT_STORAGE_PROVIDER must be explicitly configured to a real provider (s3, r2, or supabase) in production/staging \u2014 'none' (local filesystem) is development/test-only."
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_SERVICE_ROLE_KEY"], message: "required for the supabase storage provider \u2014 server-side only, never sent to the browser" });
    }
  }
});
function validateEnv(raw) {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
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
      publicWebsiteOrganizationId: env.PUBLIC_WEBSITE_ORGANIZATION_ID
    })
  };
}
function loadConfig() {
  const result = validateEnv(process.env);
  if (!result.success) {
    console.error("FATAL: invalid environment configuration. Refusing to start.\n");
    for (const message of result.errors) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }
  return result.config;
}
var config = loadConfig();

// server/core/logger.ts
import pino from "pino";
var REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.token",
  "*.sessionToken",
  "*.session_token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.webhookSecret",
  "*.gemini_api_key",
  "*.geminiApiKey",
  "*.cardNumber",
  "*.cvv"
];
var logger = pino({
  level: config.logLevel,
  base: {
    service: "artify-platform-api",
    environment: config.nodeEnv
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]"
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

// server/middleware/security.ts
var MAX_JSON_BODY_SIZE = "1mb";
var corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    logger.warn({ event: "cors_rejected", origin }, "Rejected request from disallowed CORS origin");
    callback(new Error("Not allowed by CORS policy"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Artify-Webhook-Signature"],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 600
};
function applySecurityMiddleware(app2) {
  app2.set("trust proxy", 1);
  app2.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      } : false,
      // relaxed in dev so Vite HMR / inline dev tooling isn't blocked
      crossOriginEmbedderPolicy: false
    })
  );
  app2.use(cors(corsOptions));
  app2.use(
    express.json({
      limit: MAX_JSON_BODY_SIZE,
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: MAX_JSON_BODY_SIZE, parameterLimit: 100 }));
}

// server/middleware/requestLogger.ts
import pinoHttp from "pino-http";
var requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customProps: (req) => ({
    actorId: req.user?.id,
    organizationId: req.organizationId
  }),
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode })
  }
});

// server/middleware/rateLimiter.ts
import rateLimit from "express-rate-limit";

// server/core/apiResponse.ts
function getRequestId(req) {
  const existing = req.headers["x-request-id"];
  return typeof existing === "string" && existing.length > 0 ? existing : "unknown-request-id";
}
function sendSuccess(res, data, statusCode = 200, pagination) {
  const requestId = getRequestId(res.req);
  const body = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pagination: pagination ? {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.max(1, Math.ceil(pagination.total / pagination.limit))
      } : void 0
    }
  };
  res.status(statusCode).json(body);
}
function sendError(res, statusCode, code, message, details) {
  const requestId = getRequestId(res.req);
  const body = {
    success: false,
    error: { code, message, details, requestId },
    meta: { requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
  };
  res.status(statusCode).json(body);
}

// server/middleware/rateLimiter.ts
function rateLimitHandler(req, res) {
  sendError(res, 429, "RATE_LIMIT_EXCEEDED" /* RATE_LIMIT_EXCEEDED */, "Too many requests. Please try again later.");
}
var generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Key by IP + attempted email so one IP can't lock out unrelated accounts,
  // while still throttling both credential stuffing and single-account brute force.
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  }
});
var webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1e3,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});
var passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1e3,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  }
});
var publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.ip ?? "unknown-ip"
});
var sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown"
});

// server/middleware/errorHandler.ts
import { ZodError } from "zod";

// server/core/errors.ts
var AppError = class extends Error {
  constructor(message, details) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
};
var ValidationError = class extends AppError {
  constructor(message = "Request validation failed", details) {
    super(message, details);
    this.statusCode = 400;
    this.code = "VALIDATION_ERROR" /* VALIDATION_ERROR */;
  }
};
var AuthenticationError = class extends AppError {
  constructor(message = "Authentication required") {
    super(message);
    this.statusCode = 401;
    this.code = "UNAUTHORIZED" /* UNAUTHORIZED */;
  }
};
var AuthorizationError = class extends AppError {
  constructor(message = "Permission denied") {
    super(message);
    this.statusCode = 403;
    this.code = "FORBIDDEN" /* FORBIDDEN */;
  }
};
var NotFoundError = class extends AppError {
  constructor(message = "Resource not found") {
    super(message);
    this.statusCode = 404;
    this.code = "RESOURCE_NOT_FOUND" /* RESOURCE_NOT_FOUND */;
  }
};
var ConflictError = class extends AppError {
  constructor(message = "Resource conflict", details) {
    super(message, details);
    this.statusCode = 409;
    this.code = "RESOURCE_CONFLICT" /* RESOURCE_CONFLICT */;
  }
};
var InfrastructureError = class extends AppError {
  constructor(message = "A required infrastructure dependency is unavailable") {
    super(message);
    this.statusCode = 503;
    this.code = "SERVICE_UNAVAILABLE" /* SERVICE_UNAVAILABLE */;
  }
};
var InternalError = class extends AppError {
  constructor(message = "An unexpected error occurred") {
    super(message);
    this.statusCode = 500;
    this.code = "INTERNAL_ERROR" /* INTERNAL_ERROR */;
  }
};
function isAppError(err) {
  return err instanceof AppError;
}

// server/middleware/errorHandler.ts
function notFoundHandler(req, res) {
  sendError(res, 404, "RESOURCE_NOT_FOUND" /* RESOURCE_NOT_FOUND */, `No route matches ${req.method} ${req.path}`);
}
function errorHandlerMiddleware(err, req, res, _next) {
  const requestId = req.requestId ?? "unknown-request-id";
  const log = logger.child({ requestId, route: req.path, method: req.method });
  let appError;
  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new ValidationError("Request validation failed", err.flatten());
  } else {
    appError = new InternalError("An unexpected error occurred");
    log.error({ err, event: "unhandled_error" }, "Unhandled error reached the error middleware");
  }
  if (appError.statusCode >= 500) {
    log.error({ err, event: "app_error" }, appError.message);
  } else {
    log.warn({ event: "app_error", code: appError.code }, appError.message);
  }
  const exposeDetails = appError.statusCode < 500;
  sendError(
    res,
    appError.statusCode,
    appError.code,
    appError.statusCode >= 500 ? "An unexpected error occurred" : appError.message,
    exposeDetails ? appError.details : void 0
  );
}

// server/routes/v1/index.ts
import { Router as Router30 } from "express";

// server/routes/v1/authRoutes.ts
import { Router } from "express";

// server/db/prisma.ts
import { PrismaClient } from "@prisma/client";
var prisma = new PrismaClient({
  datasourceUrl: config.databaseUrl,
  log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"]
});

// server/repositories/userRepository.ts
var userRepository = {
  async findByEmail(email) {
    return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  },
  async listForIds(ids) {
    if (ids.length === 0) return [];
    return prisma.user.findMany({ where: { id: { in: ids } } });
  },
  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },
  async create(data) {
    return prisma.user.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName} ${data.lastName}`.trim(),
        title: data.title,
        roleId: data.roleId
      }
    });
  },
  async recordSuccessfulLogin(userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: /* @__PURE__ */ new Date(), failedLoginAttempts: 0, lockedUntil: null }
    });
  },
  /** Returns true if the account is now locked as a result of this failure. Threshold/duration are centralized config (server/config/env.ts), not hard-coded here. */
  async recordFailedLogin(userId) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } }
    });
    if (user.failedLoginAttempts >= config.accountLockoutThreshold) {
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + config.accountLockoutDurationMinutes * 60 * 1e3) }
      });
      return true;
    }
    return false;
  },
  isLocked(user) {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  },
  async updatePasswordHash(userId, passwordHash) {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },
  async updateProfile(userId, data) {
    const patch = { ...data };
    const updated = await prisma.user.update({ where: { id: userId }, data: patch });
    if (data.firstName !== void 0 || data.lastName !== void 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { displayName: `${updated.firstName} ${updated.lastName}`.trim() }
      });
    }
    return prisma.user.findUniqueOrThrow({ where: { id: userId } });
  },
  async updateStatus(userId, status) {
    return prisma.user.update({ where: { id: userId }, data: { status } });
  }
};

// server/utils/crypto.ts
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
function generateSessionToken() {
  return `art_sess_${randomBytes(32).toString("hex")}`;
}
function generateResetToken() {
  return `art_reset_${randomBytes(32).toString("hex")}`;
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function generateInvitationToken() {
  return `art_invite_${randomBytes(32).toString("hex")}`;
}
function generateUploadToken() {
  return `art_upload_${randomBytes(32).toString("hex")}`;
}
function signHmac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
function verifyHmacSignature(secret, payload, providedSignatureHex) {
  if (!providedSignatureHex || typeof providedSignatureHex !== "string") return false;
  const expected = signHmac(secret, payload);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignatureHex, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// server/repositories/sessionRepository.ts
var sessionRepository = {
  async create(data) {
    return prisma.session.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        organizationId: data.organizationId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
      }
    });
  },
  async findValidByToken(token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  },
  async touchLastUsed(id) {
    await prisma.session.update({ where: { id }, data: { lastUsedAt: /* @__PURE__ */ new Date() } }).catch(() => {
    });
  },
  async revoke(token) {
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: /* @__PURE__ */ new Date() } }).catch(() => {
    });
  },
  async revokeAllForUser(userId) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  /** Revokes every other active session for the user, keeping the one matching `exceptToken` — used by change-password to avoid logging the caller out of the session they just authenticated the change with. */
  async revokeAllForUserExcept(userId, exceptToken) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: hashToken(exceptToken) } },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  /** Self-service session list (Phase 4 Security/Sessions UI) — active (unexpired, unrevoked) sessions for one user, safe fields only (never tokenHash). */
  async listActiveForUser(userId) {
    return prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: /* @__PURE__ */ new Date() } },
      orderBy: { createdAt: "desc" }
    });
  },
  /** Revokes a session only if it belongs to `userId` — returns true if a row was actually revoked, so the route can 404 rather than leak whether a foreign session id exists. */
  async revokeByIdForUser(id, userId) {
    const result = await prisma.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
    return result.count > 0;
  },
  async countActiveForOrganization(organizationId) {
    return prisma.session.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: /* @__PURE__ */ new Date() } } });
  }
};

// server/repositories/auditLogRepository.ts
var auditLogRepository = {
  /** Append-only by convention — no update/delete method exists on this repository (tests/security/audit.test.ts asserts this). */
  async record(entry) {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        actorName: entry.actorName,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId,
        result: entry.result ?? "SUCCESS",
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        beforeData: entry.beforeData,
        afterData: entry.afterData,
        metadata: entry.metadata
      }
    });
  }
};

// server/repositories/roleRepository.ts
var roleRepository = {
  async findByKey(key) {
    return prisma.role.findUnique({ where: { key } });
  },
  async findById(id) {
    return prisma.role.findUnique({ where: { id } });
  },
  /** All roles with their resolved permission sets — GET /api/v1/roles. */
  async listAllResolved() {
    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { name: "asc" }
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key)
    }));
  },
  /** Resolves a role plus its full permission-key set via role_permissions — the RBAC join, computed at read time, never stored redundantly per-user. */
  async resolveById(roleId) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } }
    });
    if (!role) return null;
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key)
    };
  }
};

// server/repositories/organizationMembershipRepository.ts
var USABLE_ORGANIZATION_STATUSES = ["ACTIVE", "TRIAL"];
var organizationMembershipRepository = {
  /** Returns the membership only if the membership itself AND the organization are both in a usable state — the single check every login/session-verification/org-switch path must use. */
  async findActiveMembership(userId, organizationId) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true }
    });
    if (!membership) return null;
    if (membership.status !== "ACTIVE") return null;
    if (!USABLE_ORGANIZATION_STATUSES.includes(membership.organization.status)) {
      return null;
    }
    return membership;
  },
  async findById(id) {
    return prisma.organizationMembership.findUnique({ where: { id }, include: { organization: true, role: true } });
  },
  async findByUserAndOrg(userId, organizationId) {
    return prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true }
    });
  },
  /** All ACTIVE memberships for a user, for GET /auth/me's org-switcher list — deliberately includes memberships in orgs the caller isn't currently "in" via their session. */
  async listActiveForUser(userId) {
    return prisma.organizationMembership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true, role: true },
      orderBy: { joinedAt: "asc" }
    });
  },
  /** Paginated membership listing for one organization — the basis of GET /api/v1/users' org-scoped list. */
  async listForOrganization(organizationId, page, limit) {
    const [rows, total] = await Promise.all([
      prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true },
        orderBy: { joinedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.organizationMembership.count({ where: { organizationId } })
    ]);
    return { rows, total };
  },
  async create(data) {
    return prisma.organizationMembership.create({
      data: {
        userId: data.userId,
        organizationId: data.organizationId,
        roleId: data.roleId,
        status: "ACTIVE",
        isPrimary: data.isPrimary ?? false
      }
    });
  },
  async updateRole(id, roleId) {
    return prisma.organizationMembership.update({ where: { id }, data: { roleId } });
  },
  async updateStatus(id, status) {
    return prisma.organizationMembership.update({ where: { id }, data: { status } });
  },
  async remove(id) {
    await prisma.organizationMembership.delete({ where: { id } });
  }
};

// server/repositories/passwordResetRepository.ts
var passwordResetRepository = {
  async create(data) {
    return prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
      }
    });
  },
  /** Returns the token row only if it is unexpired AND unused — a used or expired token is treated identically to a nonexistent one by every caller. */
  async findValidByToken(token) {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  },
  async markUsed(id) {
    await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: /* @__PURE__ */ new Date() } });
  },
  /** A fresh reset request invalidates any prior outstanding token for the same user — at most one usable reset credential at a time. */
  async invalidateAllForUser(userId) {
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: /* @__PURE__ */ new Date() }
    });
  }
};

// server/utils/password.ts
import bcrypt from "bcryptjs";
var SALT_ROUNDS = 12;
async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}
async function verifyPassword(plainTextPassword, hash) {
  return bcrypt.compare(plainTextPassword, hash);
}
var COMMON_WEAK_PASSWORDS = /* @__PURE__ */ new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein123",
  "admin1234",
  "welcome123",
  "changeme123"
]);
function validatePasswordPolicy(password) {
  if (password.length < config.passwordMinLength) {
    return `Password must be at least ${config.passwordMinLength} characters.`;
  }
  if (/^\d+$/.test(password)) {
    return "Password must not be entirely numeric.";
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return "This password is too common. Choose a less predictable password.";
  }
  return null;
}

// server/types/domain.ts
var SYSTEM_ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "VIEWER"];
function sanitizeUser(user, role) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return { ...rest, role };
}

// server/services/authService.ts
var SELF_REGISTRATION_ROLE_KEY = "ADMIN";
function sessionExpiry() {
  return new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1e3);
}
async function resolveSanitizedUserForOrganization(user, organizationId) {
  const membership = await organizationMembershipRepository.findActiveMembership(user.id, organizationId);
  if (!membership) return null;
  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) {
    throw new InternalError("User role could not be resolved.");
  }
  return sanitizeUser({ ...user, organizationId }, role);
}
var authService = {
  async login(email, password, meta = {}, targetOrganizationId) {
    const user = await userRepository.findByEmail(email);
    const genericFailure = () => new AuthenticationError("Invalid email or password credentials.");
    if (!user) throw genericFailure();
    if (userRepository.isLocked(user)) {
      throw new AuthenticationError(
        "This account is temporarily locked due to repeated failed sign-in attempts. Try again later."
      );
    }
    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      const nowLocked = await userRepository.recordFailedLogin(user.id);
      await auditLogRepository.record({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorType: "USER",
        action: "AUTH_LOGIN_FAILED",
        resourceType: "session",
        resourceId: user.id,
        result: "FAILURE",
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
      if (nowLocked) {
        logger.warn({ event: "account_locked", userId: user.id }, "Account locked after repeated failed logins");
        await auditLogRepository.record({
          organizationId: user.organizationId,
          actorUserId: user.id,
          actorType: "USER",
          action: "AUTH_ACCOUNT_LOCKED",
          resourceType: "user",
          resourceId: user.id,
          result: "FAILURE",
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
      }
      throw genericFailure();
    }
    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("This account cannot sign in. Contact your administrator.");
    }
    const organizationId = targetOrganizationId ?? user.organizationId;
    const sanitized = await resolveSanitizedUserForOrganization(user, organizationId);
    if (!sanitized) {
      throw new AuthenticationError("This account does not have active access to the requested organization.");
    }
    await userRepository.recordSuccessfulLogin(user.id);
    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: user.id,
      actorName: sanitized.displayName ?? `${user.firstName} ${user.lastName}`,
      actorType: "USER",
      action: "AUTH_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { session: { token, expiresAt }, user: sanitized };
  },
  async register(payload) {
    const existing = await userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictError("An account with this email address already exists.");
    }
    const adminRole = await roleRepository.findByKey(SELF_REGISTRATION_ROLE_KEY);
    if (!adminRole) {
      throw new InternalError("Registration is not available: required role configuration is missing.");
    }
    const passwordHash = await hashPassword(payload.password);
    await prisma.$transaction(async (tx) => {
      const baseSlug = payload.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "organization";
      let slug = baseSlug;
      let suffix = 1;
      while (await tx.organization.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
        if (suffix > 50) break;
      }
      const organization = await tx.organization.create({
        data: {
          name: payload.organizationName,
          slug,
          type: "CLIENT",
          tier: "GROWTH",
          status: "TRIAL"
        }
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: payload.email.trim().toLowerCase(),
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          displayName: `${payload.firstName} ${payload.lastName}`.trim(),
          title: "Organization Administrator",
          roleId: adminRole.id
        }
      });
      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          roleId: adminRole.id,
          status: "ACTIVE",
          isPrimary: true
        }
      });
      return { organization, user };
    });
    return this.login(payload.email, payload.password);
  },
  async verifySession(token) {
    const session = await sessionRepository.findValidByToken(token);
    if (!session) return null;
    const user = await userRepository.findById(session.userId);
    if (!user || user.status !== "ACTIVE") return null;
    const sanitized = await resolveSanitizedUserForOrganization(user, session.organizationId);
    if (!sanitized) return null;
    void sessionRepository.touchLastUsed(session.id);
    return sanitized;
  },
  async logout(token, actor, meta = {}) {
    await sessionRepository.revoke(token);
    if (actor) {
      await auditLogRepository.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorType: "USER",
        action: "AUTH_LOGOUT",
        resourceType: "session",
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
  },
  /** Revokes every active session for the user (all devices/tabs) — a broader action than logout(), which only revokes the caller's current session. */
  async logoutAll(user, meta = {}) {
    await sessionRepository.revokeAllForUser(user.id);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_LOGOUT_ALL",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  async changePassword(user, currentSessionToken, currentPassword, newPassword, meta = {}) {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");
    const validCurrent = await verifyPassword(currentPassword, fullUser.passwordHash);
    if (!validCurrent) {
      throw new AuthenticationError("Current password is incorrect.");
    }
    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);
    await sessionRepository.revokeAllForUserExcept(user.id, currentSessionToken);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_CHANGE",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Always resolves without revealing whether the email exists (§12
   * enumeration hardening). Returns a `devToken` ONLY outside production —
   * the safe development/test mechanism the brief asks for in place of a
   * real email provider (Phase 13). In production this is always
   * undefined; the raw token is never logged, never included in a
   * production response, and never persisted anywhere but as a hash.
   */
  async requestPasswordReset(email, meta = {}) {
    const user = await userRepository.findByEmail(email);
    if (!user || user.status !== "ACTIVE") {
      return {};
    }
    await passwordResetRepository.invalidateAllForUser(user.id);
    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMinutes * 60 * 1e3);
    await passwordResetRepository.create({
      token,
      userId: user.id,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return config.isProduction ? {} : { devToken: token };
  },
  async confirmPasswordReset(token, newPassword, meta = {}) {
    const resetRow = await passwordResetRepository.findValidByToken(token);
    if (!resetRow) {
      throw new AuthenticationError("This password reset link is invalid or has expired.");
    }
    const user = await userRepository.findById(resetRow.userId);
    if (!user) {
      throw new InternalError("Reset token references a user that no longer exists.");
    }
    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);
    await passwordResetRepository.markUsed(resetRow.id);
    await passwordResetRepository.invalidateAllForUser(user.id);
    await sessionRepository.revokeAllForUser(user.id);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Switches the caller's active session to a different organization they
   * hold active membership in (§18). Never trusts the target organizationId
   * without re-verifying membership; permissions are recalculated from
   * that organization's role, not carried over. Implemented as session
   * rotation (new token issued, old one revoked) rather than mutating the
   * existing session row in place.
   */
  async switchOrganization(user, currentSessionToken, targetOrganizationId, meta = {}) {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");
    const sanitized = await resolveSanitizedUserForOrganization(fullUser, targetOrganizationId);
    if (!sanitized) {
      throw new AuthorizationError("You do not have active access to the requested organization.");
    }
    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId: targetOrganizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await sessionRepository.revoke(currentSessionToken);
    await auditLogRepository.record({
      organizationId: targetOrganizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_ORGANIZATION_SWITCH",
      resourceType: "session",
      resourceId: user.id,
      beforeData: { organizationId: user.organizationId },
      afterData: { organizationId: targetOrganizationId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { session: { token, expiresAt }, user: sanitized };
  },
  /** The org-switcher list for GET /auth/me — every organization the user can currently switch into. */
  async listMemberships(userId, currentOrganizationId) {
    const memberships = await organizationMembershipRepository.listActiveForUser(userId);
    return memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      roleKey: m.role.key,
      roleName: m.role.name,
      isPrimary: m.isPrimary,
      isCurrent: m.organizationId === currentOrganizationId
    }));
  }
};

// server/utils/asyncHandler.ts
function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

// server/middleware/auth.ts
var SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return void 0;
}
var authenticateToken = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError("Authentication token is required.");
  }
  const user = await authService.verifySession(token);
  if (!user) {
    throw new AuthenticationError("Invalid or expired session token.");
  }
  req.user = user;
  req.sessionToken = token;
  req.organizationId = user.organizationId;
  next();
});
var optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (token) {
    const user = await authService.verifySession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      req.organizationId = user.organizationId;
    }
  }
  next();
});
function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY) return next();
    if (!req.user.role.permissions.includes(permission)) {
      throw new AuthorizationError(`Permission denied. Required privilege: "${permission}"`);
    }
    next();
  };
}
function requireRole(allowedRoleKeys) {
  return (req, _res, next) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY || allowedRoleKeys.includes(req.user.role.key)) {
      return next();
    }
    throw new AuthorizationError(`Forbidden. Requires one of: ${allowedRoleKeys.join(", ")}`);
  };
}

// server/schemas/authSchemas.ts
import { z as z2 } from "zod";
var newPasswordSchema = z2.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) {
    ctx.addIssue({ code: z2.ZodIssueCode.custom, message: issue });
  }
});
var loginSchema = z2.object({
  email: z2.string().trim().min(1).email(),
  password: z2.string().min(1)
});
var registerSchema = z2.object({
  email: z2.string().trim().min(1).email(),
  password: newPasswordSchema,
  firstName: z2.string().trim().min(1).max(100),
  lastName: z2.string().trim().min(1).max(100),
  organizationName: z2.string().trim().min(1).max(200)
});
var changePasswordSchema = z2.object({
  currentPassword: z2.string().min(1),
  newPassword: newPasswordSchema
}).refine((v) => v.currentPassword !== v.newPassword, {
  message: "New password must be different from the current password.",
  path: ["newPassword"]
});
var passwordResetRequestSchema = z2.object({
  email: z2.string().trim().min(1).email()
});
var passwordResetConfirmSchema = z2.object({
  token: z2.string().trim().min(1),
  newPassword: newPasswordSchema
});
var switchOrganizationSchema = z2.object({
  organizationId: z2.string().trim().uuid()
});

// server/routes/v1/authRoutes.ts
var router = Router();
function requestMeta(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input.email, input.password, requestMeta(req));
    sendSuccess(res, result);
  })
);
router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    sendSuccess(res, result, 201);
  })
);
router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const organizations = await authService.listMemberships(req.user.id, req.user.organizationId);
    sendSuccess(res, { user: req.user, organizations });
  })
);
router.post(
  "/logout",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await authService.logout(
        req.sessionToken,
        { userId: req.user.id, organizationId: req.user.organizationId },
        requestMeta(req)
      );
    }
    sendSuccess(res, { message: "Logged out successfully." });
  })
);
router.post(
  "/logout-all",
  authenticateToken,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user, requestMeta(req));
    sendSuccess(res, { message: "All sessions have been revoked." });
  })
);
router.post(
  "/change-password",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    await authService.changePassword(req.user, req.sessionToken, input.currentPassword, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password changed successfully. Other active sessions have been signed out." });
  })
);
router.post(
  "/password-reset/request",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetRequestSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input.email, requestMeta(req));
    sendSuccess(res, {
      message: "If an account with that email exists, password reset instructions have been sent.",
      // Present only outside production — see authService.requestPasswordReset's doc comment.
      ...result.devToken ? { devToken: result.devToken } : {}
    });
  })
);
router.post(
  "/password-reset/confirm",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetConfirmSchema.parse(req.body);
    await authService.confirmPasswordReset(input.token, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password has been reset. Please sign in with your new password." });
  })
);
router.get(
  "/sessions",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const [sessions, currentSession] = await Promise.all([
      sessionRepository.listActiveForUser(req.user.id),
      req.sessionToken ? sessionRepository.findValidByToken(req.sessionToken) : null
    ]);
    sendSuccess(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        isCurrent: currentSession?.id === s.id
      }))
    });
  })
);
router.post(
  "/sessions/:id/revoke",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const revoked = await sessionRepository.revokeByIdForUser(req.params.id, req.user.id);
    if (!revoked) throw new NotFoundError("Session not found.");
    await auditLogRepository.record({
      organizationId: req.user.organizationId,
      actorUserId: req.user.id,
      actorType: "USER",
      action: "AUTH_SESSION_REVOKED",
      resourceType: "session",
      resourceId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { message: "Session revoked." });
  })
);
router.post(
  "/switch-organization",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = switchOrganizationSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    const result = await authService.switchOrganization(req.user, req.sessionToken, input.organizationId, requestMeta(req));
    sendSuccess(res, result);
  })
);
var authRoutes_default = router;

// server/routes/v1/webhookRoutes.ts
import { Router as Router2 } from "express";

// server/repositories/webhookEventRepository.ts
import { Prisma } from "@prisma/client";
var UNIQUE_CONSTRAINT_VIOLATION = "P2002";
var webhookEventRepository = {
  /**
   * Records an inbound webhook delivery. Returns `{ duplicate: true }`
   * instead of throwing if (provider, deliveryId) was already recorded —
   * this is the idempotency/replay guard required by Phase 1 §20 and
   * docs/SECURITY_MODEL.md.
   */
  async recordDelivery(entry) {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: entry.provider,
          deliveryId: entry.deliveryId,
          eventType: entry.eventType,
          signatureValid: entry.signatureValid,
          status: entry.status,
          payload: entry.payload,
          organizationId: entry.organizationId
        }
      });
      return { duplicate: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return { duplicate: true };
      }
      throw err;
    }
  },
  async findByDeliveryId(provider, deliveryId) {
    return prisma.webhookEvent.findUnique({
      where: { provider_deliveryId: { provider, deliveryId } }
    });
  }
};

// server/services/webhookService.ts
var REPLAY_WINDOW_SECONDS = 5 * 60;
var SIGNATURE_HEADER = "x-artify-webhook-signature";
var TIMESTAMP_HEADER = "x-artify-webhook-timestamp";
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function verifyWebhookSignature(input) {
  const signature = firstHeaderValue(input.signatureHeader);
  const timestampRaw = firstHeaderValue(input.timestampHeader);
  if (!signature || !timestampRaw || !input.rawBody) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  const skewSeconds = Math.abs(nowSeconds - timestamp);
  if (skewSeconds > REPLAY_WINDOW_SECONDS) {
    throw new AuthenticationError("Webhook signature has expired.");
  }
  const signedPayload = Buffer.concat([Buffer.from(`${timestampRaw}.`), input.rawBody]);
  const valid = verifyHmacSignature(config.webhookSecret, signedPayload, signature);
  if (!valid) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
}
var webhookService = {
  /**
   * Verifies the signature, then atomically records the delivery for
   * idempotency. Throws ConflictError on a duplicate delivery (same
   * provider + deliveryId already recorded) — the caller returns 200 for
   * duplicates per standard webhook convention (already-processed is not
   * an error to the sender), which the route handler decides, not this
   * service.
   */
  async ingestLeadEvent(payload, verification) {
    verifyWebhookSignature(verification);
    const { duplicate } = await webhookEventRepository.recordDelivery({
      provider: "artify-website",
      deliveryId: payload.deliveryId,
      eventType: payload.eventType,
      signatureValid: true,
      status: "VERIFIED",
      payload
    });
    if (duplicate) {
      logger.info({ event: "webhook_duplicate", deliveryId: payload.deliveryId }, "Duplicate webhook delivery ignored");
      return { duplicate: true };
    }
    logger.info({ event: "webhook_received", deliveryId: payload.deliveryId }, "Lead webhook verified and recorded");
    return { duplicate: false };
  }
};

// server/schemas/webhookSchemas.ts
import { z as z3 } from "zod";
var leadWebhookPayloadSchema = z3.object({
  deliveryId: z3.string().min(1).max(200),
  eventType: z3.string().min(1).max(100).default("lead.created"),
  name: z3.string().min(1).max(200),
  email: z3.string().email(),
  companyName: z3.string().min(1).max(200),
  projectBrief: z3.string().min(1).max(5e3),
  source: z3.string().max(100).optional()
});

// server/routes/v1/webhookRoutes.ts
var router2 = Router2();
router2.post(
  "/leads",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const payload = leadWebhookPayloadSchema.parse(req.body);
    const result = await webhookService.ingestLeadEvent(payload, {
      rawBody: req.rawBody,
      signatureHeader: req.headers[SIGNATURE_HEADER],
      timestampHeader: req.headers[TIMESTAMP_HEADER]
    });
    sendSuccess(res, { accepted: true, duplicate: result.duplicate });
  })
);
var webhookRoutes_default = router2;

// server/routes/v1/systemRoutes.ts
import { Router as Router3 } from "express";

// server/db/health.ts
var READINESS_TIMEOUT_MS = 2e3;
async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
async function checkDatabase() {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    return { name: "postgresql", healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.error({ err, event: "db_health_check_failed" }, "Database readiness check failed");
    return { name: "postgresql", healthy: false };
  }
}

// server/routes/v1/systemRoutes.ts
var router3 = Router3();
router3.get("/live", (_req, res) => {
  sendSuccess(res, { status: "alive", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
router3.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();
    const dependencies = [dbCheck];
    const healthy = dependencies.every((dep) => dep.healthy);
    sendSuccess(
      res,
      {
        status: healthy ? "ready" : "not_ready",
        environment: config.nodeEnv,
        dependencies: dependencies.map((dep) => ({ name: dep.name, healthy: dep.healthy, latencyMs: dep.latencyMs })),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      healthy ? 200 : 503
    );
  })
);
router3.get(
  "/database",
  authenticateToken,
  requireRole(["SUPER_ADMIN"]),
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();
    const [migrations, organizationCount, userCount, roleCount, permissionCount] = await Promise.all([
      prisma.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`,
      prisma.organization.count(),
      prisma.user.count(),
      prisma.role.count(),
      prisma.permission.count()
    ]);
    sendSuccess(res, {
      provider: "PostgreSQL",
      healthy: dbCheck.healthy,
      latencyMs: dbCheck.latencyMs,
      migrations: {
        applied: migrations.filter((m) => m.finished_at !== null).length,
        pending: migrations.filter((m) => m.finished_at === null).length,
        names: migrations.map((m) => m.migration_name)
      },
      counts: {
        organizations: organizationCount,
        users: userCount,
        roles: roleCount,
        permissions: permissionCount
      }
    });
  })
);
var systemRoutes_default = router3;

// server/routes/v1/userRoutes.ts
import { Router as Router4 } from "express";

// server/services/userService.ts
async function resolveRoleOrThrow(roleKey) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}
async function loadUserInOrgOrThrow(userId, organizationId) {
  const membership = await organizationMembershipRepository.findByUserAndOrg(userId, organizationId);
  if (!membership) throw new NotFoundError("User not found.");
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found.");
  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) throw new NotFoundError("User not found.");
  return sanitizeUser({ ...user, organizationId }, role);
}
var userService = {
  async listUsers(organizationId, page, limit) {
    const { rows, total } = await organizationMembershipRepository.listForOrganization(organizationId, page, limit);
    const users = rows.map((m) => sanitizeUser({ ...m.user, organizationId }, { id: m.role.id, key: m.role.key, name: m.role.name, permissions: [] }));
    return { users, total };
  },
  async getUser(organizationId, userId) {
    return loadUserInOrgOrThrow(userId, organizationId);
  },
  async createUser(caller, input, meta = {}) {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError("An account with this email address already exists.");
    const role = await resolveRoleOrThrow(input.roleKey);
    const passwordHash = await hashPassword(input.password);
    const user = await userRepository.create({
      organizationId: caller.organizationId,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      title: input.title,
      roleId: role.id
    });
    await organizationMembershipRepository.create({
      userId: user.id,
      organizationId: caller.organizationId,
      roleId: role.id,
      isPrimary: true
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: user.id,
      afterData: { email: user.email, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return sanitizeUser({ ...user, organizationId: caller.organizationId }, { id: role.id, key: role.key, name: role.name, permissions: [] });
  },
  async updateUser(caller, targetUserId, input, callerPermissions, meta = {}) {
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, caller.organizationId);
    if (!membership) throw new NotFoundError("User not found.");
    const beforeRoleKey = membership.role.key;
    if (input.roleKey !== void 0) {
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      if (targetUserId === caller.id) {
        throw new AuthorizationError("You cannot change your own role.");
      }
      const newRole = await resolveRoleOrThrow(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, newRole.id);
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "user",
        resourceId: targetUserId,
        beforeData: { roleKey: beforeRoleKey },
        afterData: { roleKey: newRole.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    const profilePatch = {};
    if (input.firstName !== void 0) profilePatch.firstName = input.firstName;
    if (input.lastName !== void 0) profilePatch.lastName = input.lastName;
    if (input.title !== void 0) profilePatch.title = input.title;
    if (input.phone !== void 0) profilePatch.phone = input.phone;
    if (input.status !== void 0) profilePatch.status = input.status;
    if (Object.keys(profilePatch).length > 0) {
      await userRepository.updateProfile(targetUserId, profilePatch);
      if (input.status !== void 0) {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_STATUS_CHANGED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: { status: input.status },
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
        if (input.status === "DISABLED") {
          await sessionRepository.revokeAllForUser(targetUserId);
        }
      } else {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_UPDATED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: profilePatch,
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
      }
    }
    return loadUserInOrgOrThrow(targetUserId, caller.organizationId);
  }
};

// server/schemas/userSchemas.ts
import { z as z4 } from "zod";
var newPasswordSchema2 = z4.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z4.ZodIssueCode.custom, message: issue });
});
var assignableRoleKeySchema = z4.enum(
  SYSTEM_ROLE_KEYS.filter((k) => k !== "SUPER_ADMIN")
);
var listUsersQuerySchema = z4.object({
  page: z4.coerce.number().int().positive().default(1),
  limit: z4.coerce.number().int().positive().max(100).default(20),
  organizationId: z4.string().trim().uuid().optional()
});
var createUserSchema = z4.object({
  email: z4.string().trim().min(1).email(),
  password: newPasswordSchema2,
  firstName: z4.string().trim().min(1).max(100),
  lastName: z4.string().trim().min(1).max(100),
  title: z4.string().trim().max(150).optional(),
  roleKey: assignableRoleKeySchema
});
var updateUserSchema = z4.object({
  firstName: z4.string().trim().min(1).max(100).optional(),
  lastName: z4.string().trim().min(1).max(100).optional(),
  title: z4.string().trim().max(150).nullable().optional(),
  phone: z4.string().trim().max(50).nullable().optional(),
  status: z4.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
  roleKey: assignableRoleKeySchema.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var addMemberSchema = z4.object({
  userId: z4.string().trim().uuid(),
  roleKey: assignableRoleKeySchema
});
var updateMemberSchema = z4.object({
  roleKey: assignableRoleKeySchema.optional(),
  status: z4.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/userRoutes.ts
var router4 = Router4();
router4.use(authenticateToken);
router4.get(
  "/",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const organizationId = req.user.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user.organizationId;
    const { users, total } = await userService.listUsers(organizationId, query.page, query.limit);
    sendSuccess(res, { users }, 200, { page: query.page, limit: query.limit, total });
  })
);
router4.get(
  "/:id",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const user = await userService.getUser(req.user.organizationId, req.params.id);
    sendSuccess(res, { user });
  })
);
router4.post(
  "/",
  requirePermission("users.create"),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(req.user, input, { ip: req.ip, userAgent: req.headers["user-agent"] });
    sendSuccess(res, { user }, 201);
  })
);
router4.patch(
  "/:id",
  requirePermission("users.update"),
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(req.user, req.params.id, input, req.user.role.permissions, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { user });
  })
);
var userRoutes_default = router4;

// server/routes/v1/roleRoutes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.use(authenticateToken);
router5.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const roles = await roleRepository.listAllResolved();
    sendSuccess(res, { roles });
  })
);
var roleRoutes_default = router5;
var permissionsRouter = Router5();
permissionsRouter.use(authenticateToken);
permissionsRouter.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] });
    sendSuccess(res, { permissions });
  })
);

// server/routes/v1/organizationRoutes.ts
import { Router as Router6 } from "express";

// server/repositories/organizationRepository.ts
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
var organizationRepository = {
  async findById(id) {
    return prisma.organization.findUnique({ where: { id } });
  },
  async findBySlug(slug) {
    return prisma.organization.findUnique({ where: { slug } });
  },
  /** Finds the platform operator's own organization (type=INTERNAL). Used for "global" settings ownership — see SystemSetting's schema doc comment. */
  async findInternal() {
    return prisma.organization.findFirst({ where: { type: "INTERNAL" } });
  },
  async create(data) {
    const baseSlug = slugify(data.name) || "organization";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return prisma.organization.create({
      data: {
        name: data.name,
        slug,
        tier: "GROWTH",
        status: "TRIAL",
        type: "CLIENT"
      }
    });
  }
};

// server/services/organizationService.ts
async function resolveRoleOrThrow2(roleKey) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}
var organizationService = {
  async listOrganizations(caller) {
    if (caller.role.key === "SUPER_ADMIN") {
      return prisma.organization.findMany({ orderBy: { name: "asc" } });
    }
    const memberships = await organizationMembershipRepository.listActiveForUser(caller.id);
    return memberships.map((m) => m.organization);
  },
  async getOrganization(caller, organizationId) {
    if (caller.role.key !== "SUPER_ADMIN") {
      const membership = await organizationMembershipRepository.findActiveMembership(caller.id, organizationId);
      if (!membership) throw new NotFoundError("Organization not found.");
    }
    const org = await organizationRepository.findById(organizationId);
    if (!org) throw new NotFoundError("Organization not found.");
    return org;
  },
  async addMember(caller, organizationId, input, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const targetUser = await userRepository.findById(input.userId);
    if (!targetUser) throw new NotFoundError("User not found.");
    const existing = await organizationMembershipRepository.findByUserAndOrg(input.userId, organizationId);
    if (existing) throw new ValidationError("This user is already a member of the organization.");
    const role = await resolveRoleOrThrow2(input.roleKey);
    const membership = await organizationMembershipRepository.create({
      userId: input.userId,
      organizationId,
      roleId: role.id
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_ADDED",
      resourceType: "organization_membership",
      resourceId: membership.id,
      afterData: { userId: input.userId, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return membership;
  },
  async updateMember(caller, organizationId, targetUserId, input, callerPermissions, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id && input.roleKey !== void 0) {
      throw new AuthorizationError("You cannot change your own role.");
    }
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");
    if (input.roleKey !== void 0) {
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      const role = await resolveRoleOrThrow2(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, role.id);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        beforeData: { roleKey: membership.role.key },
        afterData: { roleKey: role.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    if (input.status !== void 0) {
      await organizationMembershipRepository.updateStatus(membership.id, input.status);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "ORG_MEMBERSHIP_UPDATED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        afterData: { status: input.status },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return organizationMembershipRepository.findById(membership.id);
  },
  async removeMember(caller, organizationId, targetUserId, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id) {
      throw new AuthorizationError("You cannot remove your own membership.");
    }
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");
    await organizationMembershipRepository.remove(membership.id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_REMOVED",
      resourceType: "organization_membership",
      resourceId: targetUserId,
      beforeData: { roleKey: membership.role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/organizationRoutes.ts
var router6 = Router6();
router6.use(authenticateToken);
router6.get(
  "/",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organizations = await organizationService.listOrganizations(req.user);
    sendSuccess(res, { organizations });
  })
);
router6.get(
  "/:id",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organization = await organizationService.getOrganization(req.user, req.params.id);
    sendSuccess(res, { organization });
  })
);
router6.get(
  "/:id/summary",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user.role.key !== "SUPER_ADMIN" && req.params.id !== req.user.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const [{ total: memberCount }, activeSessionCount] = await Promise.all([
      organizationMembershipRepository.listForOrganization(req.params.id, 1, 1),
      sessionRepository.countActiveForOrganization(req.params.id)
    ]);
    sendSuccess(res, { memberCount, activeSessionCount });
  })
);
router6.get(
  "/:id/members",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user.role.key !== "SUPER_ADMIN" && req.params.id !== req.user.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const query = listUsersQuerySchema.parse(req.query);
    const { rows, total } = await organizationMembershipRepository.listForOrganization(req.params.id, query.page, query.limit);
    const members = rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName,
      status: m.status,
      isPrimary: m.isPrimary,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt
    }));
    sendSuccess(res, { members }, 200, { page: query.page, limit: query.limit, total });
  })
);
router6.post(
  "/:id/members",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = addMemberSchema.parse(req.body);
    const membership = await organizationService.addMember(req.user, req.params.id, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { membership }, 201);
  })
);
router6.patch(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = updateMemberSchema.parse(req.body);
    const membership = await organizationService.updateMember(
      req.user,
      req.params.id,
      req.params.userId,
      input,
      req.user.role.permissions,
      { ip: req.ip, userAgent: req.headers["user-agent"] }
    );
    sendSuccess(res, { membership });
  })
);
router6.delete(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    await organizationService.removeMember(req.user, req.params.id, req.params.userId, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { message: "Membership removed." });
  })
);
var organizationRoutes_default = router6;

// server/routes/v1/auditLogRoutes.ts
import { Router as Router7 } from "express";

// server/repositories/auditLogQueryRepository.ts
var auditLogQueryRepository = {
  async list(filters, page, limit) {
    const where = {
      organizationId: filters.organizationId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      resourceType: filters.resourceType,
      result: filters.result,
      actorType: filters.actorType
    };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...filters.dateFrom ? { gte: filters.dateFrom } : {},
        ...filters.dateTo ? { lte: filters.dateTo } : {}
      };
    }
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.auditLog.count({ where })
    ]);
    return { rows, total };
  }
};

// server/schemas/auditLogSchemas.ts
import { z as z5 } from "zod";
var listAuditLogsQuerySchema = z5.object({
  page: z5.coerce.number().int().positive().default(1),
  limit: z5.coerce.number().int().positive().max(100).default(20),
  organizationId: z5.string().trim().uuid().optional(),
  actorUserId: z5.string().trim().uuid().optional(),
  action: z5.string().trim().max(100).optional(),
  resourceType: z5.string().trim().max(100).optional(),
  result: z5.enum(["SUCCESS", "FAILURE"]).optional(),
  dateFrom: z5.coerce.date().optional(),
  dateTo: z5.coerce.date().optional()
});

// server/routes/v1/auditLogRoutes.ts
var router7 = Router7();
router7.use(authenticateToken);
router7.get(
  "/",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const organizationId = req.user.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user.organizationId;
    const { rows, total } = await auditLogQueryRepository.list(
      {
        organizationId,
        actorUserId: query.actorUserId,
        action: query.action,
        resourceType: query.resourceType,
        result: query.result,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo
      },
      query.page,
      query.limit
    );
    sendSuccess(res, { auditLogs: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
var auditLogRoutes_default = router7;

// server/routes/v1/settingsRoutes.ts
import { Router as Router8 } from "express";

// server/repositories/systemSettingRepository.ts
var systemSettingRepository = {
  async listForOrganization(organizationId) {
    return prisma.systemSetting.findMany({ where: { organizationId }, orderBy: { key: "asc" } });
  },
  async upsert(data) {
    return prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: data.organizationId, key: data.key } },
      update: {
        value: data.value,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById
      },
      create: {
        organizationId: data.organizationId,
        key: data.key,
        value: data.value,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById
      }
    });
  }
};

// server/schemas/settingsSchemas.ts
import { z as z6 } from "zod";
var updateSettingSchema = z6.object({
  value: z6.unknown(),
  type: z6.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).default("STRING"),
  description: z6.string().trim().max(500).optional()
});

// server/routes/v1/settingsRoutes.ts
var router8 = Router8();
router8.use(authenticateToken);
router8.get(
  "/",
  requirePermission("settings.read"),
  asyncHandler(async (req, res) => {
    const settings = await systemSettingRepository.listForOrganization(req.user.organizationId);
    sendSuccess(res, { settings });
  })
);
router8.patch(
  "/:key",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = updateSettingSchema.parse(req.body);
    const setting = await systemSettingRepository.upsert({
      organizationId: req.user.organizationId,
      key: req.params.key,
      value: input.value,
      type: input.type,
      description: input.description,
      updatedById: req.user.id
    });
    await auditLogRepository.record({
      organizationId: req.user.organizationId,
      actorUserId: req.user.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      resourceType: "system_setting",
      resourceId: setting.id,
      afterData: { key: setting.key },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { setting });
  })
);
var settingsRoutes_default = router8;

// server/routes/v1/leadRoutes.ts
import { Router as Router9 } from "express";

// server/repositories/leadRepository.ts
function buildWhere(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { companyName: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var leadRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.lead.count({ where })
    ]);
    return { rows, total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped, so a cross-tenant id guess returns null, never another org's row (§4). */
  async findByIdInOrg(id, organizationId) {
    return prisma.lead.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async findByEmailInOrg(organizationId, email) {
    return prisma.lead.findMany({
      where: { organizationId, email, deletedAt: null, status: { notIn: ["CONVERTED", "LOST"] } }
    });
  },
  async create(data) {
    return prisma.lead.create({
      data: {
        organizationId: data.organizationId,
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        source: data.source,
        status: data.status ?? "NEW",
        notes: data.notes,
        assignedTo: data.assignedTo
      }
    });
  },
  async update(id, data) {
    return prisma.lead.update({ where: { id }, data });
  },
  async softDelete(id) {
    await prisma.lead.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  async countByStatus(organizationId) {
    const rows = await prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true }
    });
    const result = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },
  async recentForOrg(organizationId, limit) {
    return prisma.lead.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }
};

// server/repositories/clientRepository.ts
var clientWithWorkspace = { include: { workspaceOrganization: true } };
function buildWhere2(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { legalName: { contains: term, mode: "insensitive" } },
      { clientCode: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var clientRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere2(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.client.findMany({
        where,
        ...clientWithWorkspace,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.client.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.client.findFirst({ where: { id, organizationId, deletedAt: null }, ...clientWithWorkspace });
  },
  /**
   * The Client Portal boundary (Phase 10 §25/§26 —
   * docs/CLIENT_PORTAL_ARCHITECTURE.md): Contract/Subscription/Invoice/
   * Payment.organizationId is always the AGENCY's own org (the same org
   * that owns this Client row), never the client's own provisioned
   * workspace org — so portal access resolves the caller's *session*
   * organizationId (after they've switched into a client's workspace via
   * the Phase 3 switchOrganization mechanism) to the one Client row whose
   * `workspaceOrganizationId` matches, then scopes every portal query by
   * that Client's id. An agency staffer viewing their own internal org
   * naturally finds no matching row here and is blocked from a portal
   * view of it.
   */
  async findByWorkspaceOrganizationId(workspaceOrganizationId) {
    return prisma.client.findFirst({ where: { workspaceOrganizationId, deletedAt: null } });
  },
  /** Case-insensitive duplicate-name check within a tenant (§19) — soft, service-level, not a DB unique constraint (see schema.prisma's Client doc comment for why). */
  async findByNameInOrg(organizationId, name) {
    return prisma.client.findFirst({
      where: { organizationId, deletedAt: null, name: { equals: name, mode: "insensitive" } }
    });
  },
  async findByCodeInOrg(organizationId, clientCode) {
    return prisma.client.findFirst({ where: { organizationId, clientCode, deletedAt: null } });
  },
  async create(data) {
    return prisma.client.create({
      data: {
        organizationId: data.organizationId,
        clientCode: data.clientCode,
        name: data.name,
        legalName: data.legalName,
        status: data.status ?? "PROSPECT",
        email: data.email,
        phone: data.phone,
        website: data.website,
        address: data.address,
        accountManager: data.accountManager,
        notes: data.notes
      }
    });
  },
  async update(id, data) {
    return prisma.client.update({ where: { id }, data });
  },
  async softDelete(id) {
    await prisma.client.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  async countByStatus(organizationId) {
    const rows = await prisma.client.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true }
    });
    const result = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },
  async recentForOrg(organizationId, limit) {
    return prisma.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }
};

// server/services/leadService.ts
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["CONVERTED"]);
var NON_TERMINAL_STATUSES = /* @__PURE__ */ new Set(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);
function assertValidTransition(current, next) {
  if (current === next) return;
  if (TERMINAL_STATUSES.has(current)) {
    throw new ConflictError("This lead has already been converted; its status can no longer be changed.");
  }
  if (!NON_TERMINAL_STATUSES.has(next)) {
    throw new ValidationError('Use POST /leads/:id/convert to mark a lead as converted \u2014 status cannot be set to "CONVERTED" directly.');
  }
}
async function loadLeadInOrgOrThrow(id, organizationId) {
  const lead = await leadRepository.findByIdInOrg(id, organizationId);
  if (!lead) throw new NotFoundError("Lead not found.");
  return lead;
}
function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts.slice(1).join(" ") || (parts[0] ?? fullName);
  return { firstName: parts[0] ?? fullName, lastName };
}
var leadService = {
  async listLeads(organizationId, filters, page, limit, sort, order) {
    return leadRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getLead(organizationId, id) {
    return loadLeadInOrgOrThrow(id, organizationId);
  },
  async createLead(caller, input, meta = {}) {
    const email = input.email || void 0;
    if (email) {
      const duplicates = await leadRepository.findByEmailInOrg(caller.organizationId, email);
      if (duplicates.length > 0) {
        throw new ConflictError("An open lead with this email already exists for this organization.", {
          existingLeadId: duplicates[0].id
        });
      }
    }
    const lead = await leadRepository.create({
      organizationId: caller.organizationId,
      companyName: input.companyName,
      contactName: input.contactName,
      email,
      phone: input.phone,
      source: input.source,
      status: input.status,
      notes: input.notes,
      assignedTo: input.assignedTo
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, status: lead.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return lead;
  },
  async updateLead(caller, id, input, meta = {}) {
    const existing = await loadLeadInOrgOrThrow(id, caller.organizationId);
    if (input.status !== void 0) {
      assertValidTransition(existing.status, input.status);
    } else if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This lead has already been converted and can no longer be edited.");
    }
    const patch = {};
    if (input.companyName !== void 0) patch.companyName = input.companyName;
    if (input.contactName !== void 0) patch.contactName = input.contactName;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.source !== void 0) patch.source = input.source;
    if (input.status !== void 0) patch.status = input.status;
    if (input.notes !== void 0) patch.notes = input.notes;
    if (input.assignedTo !== void 0) patch.assignedTo = input.assignedTo;
    const updated = await leadRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_UPDATED",
      resourceType: "lead",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteLead(caller, id, meta = {}) {
    await loadLeadInOrgOrThrow(id, caller.organizationId);
    await leadRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_ARCHIVED",
      resourceType: "lead",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Transactional lead→client conversion (§15-17). Race-safe: the lead's
   * status flip uses a conditional `updateMany` (status != CONVERTED)
   * inside the transaction and checks the affected row count — a
   * concurrent duplicate conversion attempt affects 0 rows, throws, and
   * rolls back the whole transaction (including the client/contact rows
   * already created in it), rather than racing on a read-then-write.
   */
  async convertLead(caller, id, input, meta = {}) {
    const lead = await loadLeadInOrgOrThrow(id, caller.organizationId);
    if (lead.status === "CONVERTED") {
      throw new ConflictError("This lead has already been converted.", { convertedClientId: lead.convertedClientId });
    }
    const existingCode = await clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode);
    if (existingCode) {
      throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    }
    const result = await prisma.$transaction(async (tx) => {
      const client3 = await tx.client.create({
        data: {
          organizationId: caller.organizationId,
          clientCode: input.clientCode,
          name: input.name ?? lead.companyName,
          status: "ACTIVE",
          email: input.email ?? lead.email ?? void 0,
          phone: input.phone ?? lead.phone ?? void 0,
          website: input.website,
          address: input.address
        }
      });
      let contactId = null;
      if (input.createContact && lead.contactName) {
        const { firstName, lastName } = splitName(lead.contactName);
        const contact = await tx.contact.create({
          data: {
            organizationId: caller.organizationId,
            clientId: client3.id,
            firstName,
            lastName,
            email: lead.email ?? void 0,
            phone: lead.phone ?? void 0,
            isPrimary: true
          }
        });
        contactId = contact.id;
      }
      const conversion = await tx.lead.updateMany({
        where: { id, organizationId: caller.organizationId, status: { not: "CONVERTED" } },
        data: { status: "CONVERTED", convertedClientId: client3.id, convertedAt: /* @__PURE__ */ new Date() }
      });
      if (conversion.count !== 1) {
        throw new ConflictError("This lead has already been converted.");
      }
      return { client: client3, contactId };
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: result.client.id,
      afterData: { clientCode: result.client.clientCode, name: result.client.name, convertedFromLeadId: id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CONVERTED",
      resourceType: "lead",
      resourceId: id,
      afterData: { clientId: result.client.id, clientCode: result.client.clientCode },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return result;
  },
  async dashboardCounts(organizationId) {
    return leadRepository.countByStatus(organizationId);
  },
  async recent(organizationId, limit) {
    return leadRepository.recentForOrg(organizationId, limit);
  }
};

// server/schemas/leadSchemas.ts
import { z as z7 } from "zod";
var leadStatusSchema = z7.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);
var listLeadsQuerySchema = z7.object({
  page: z7.coerce.number().int().positive().default(1),
  limit: z7.coerce.number().int().positive().max(100).default(20),
  search: z7.string().trim().max(200).optional(),
  status: z7.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  source: z7.string().trim().max(100).optional(),
  assignedTo: z7.string().trim().uuid().optional(),
  dateFrom: z7.coerce.date().optional(),
  dateTo: z7.coerce.date().optional(),
  sort: z7.enum(["createdAt", "updatedAt", "companyName", "status"]).default("createdAt"),
  order: z7.enum(["asc", "desc"]).default("desc")
});
var createLeadSchema = z7.object({
  companyName: z7.string().trim().min(1).max(200),
  contactName: z7.string().trim().max(200).optional(),
  email: z7.string().trim().email().max(255).optional().or(z7.literal("")),
  phone: z7.string().trim().max(50).optional(),
  source: z7.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
  notes: z7.string().trim().max(5e3).optional(),
  assignedTo: z7.string().trim().uuid().optional()
});
var updateLeadSchema = z7.object({
  companyName: z7.string().trim().min(1).max(200).optional(),
  contactName: z7.string().trim().max(200).nullable().optional(),
  email: z7.string().trim().email().max(255).nullable().optional().or(z7.literal("")),
  phone: z7.string().trim().max(50).nullable().optional(),
  source: z7.string().trim().max(100).nullable().optional(),
  status: leadStatusSchema.optional(),
  notes: z7.string().trim().max(5e3).nullable().optional(),
  assignedTo: z7.string().trim().uuid().nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var convertLeadSchema = z7.object({
  clientCode: z7.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z7.string().trim().min(1).max(200).optional(),
  email: z7.string().trim().email().max(255).optional(),
  phone: z7.string().trim().max(50).optional(),
  website: z7.string().trim().max(255).optional(),
  address: z7.string().trim().max(500).optional(),
  createContact: z7.boolean().default(true)
});

// server/routes/v1/leadRoutes.ts
var router9 = Router9();
router9.use(authenticateToken);
function requestMeta2(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router9.get(
  "/",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const query = listLeadsQuerySchema.parse(req.query);
    const { rows, total } = await leadService.listLeads(
      req.user.organizationId,
      { search: query.search, status: query.status, source: query.source, assignedTo: query.assignedTo, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { leads: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router9.get(
  "/:id",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const lead = await leadService.getLead(req.user.organizationId, req.params.id);
    sendSuccess(res, { lead });
  })
);
router9.post(
  "/",
  requirePermission("leads.create"),
  asyncHandler(async (req, res) => {
    const input = createLeadSchema.parse(req.body);
    const lead = await leadService.createLead(req.user, input, requestMeta2(req));
    sendSuccess(res, { lead }, 201);
  })
);
router9.patch(
  "/:id",
  requirePermission("leads.update"),
  asyncHandler(async (req, res) => {
    const input = updateLeadSchema.parse(req.body);
    const lead = await leadService.updateLead(req.user, req.params.id, input, requestMeta2(req));
    sendSuccess(res, { lead });
  })
);
router9.delete(
  "/:id",
  requirePermission("leads.delete"),
  asyncHandler(async (req, res) => {
    await leadService.deleteLead(req.user, req.params.id, requestMeta2(req));
    sendSuccess(res, { message: "Lead archived." });
  })
);
router9.post(
  "/:id/convert",
  requirePermission("leads.convert"),
  asyncHandler(async (req, res) => {
    const input = convertLeadSchema.parse(req.body);
    const result = await leadService.convertLead(req.user, req.params.id, input, requestMeta2(req));
    sendSuccess(res, result, 201);
  })
);
var leadRoutes_default = router9;

// server/routes/v1/clientRoutes.ts
import { Router as Router10 } from "express";

// server/services/clientService.ts
async function loadClientInOrgOrThrow(id, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(id, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
function computeProvisioningStatus(workspace) {
  if (!workspace) return "NOT_PROVISIONED";
  if (workspace.status === "ACTIVE") return "PROVISIONED";
  if (workspace.status === "TRIAL") return "PROVISIONING";
  return "SUSPENDED";
}
function withProvisioningStatus(client3) {
  return { ...client3, provisioningStatus: computeProvisioningStatus(client3.workspaceOrganization) };
}
var clientService = {
  async listClients(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await clientRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withProvisioningStatus), total };
  },
  async getClient(organizationId, id) {
    const client3 = await loadClientInOrgOrThrow(id, organizationId);
    return withProvisioningStatus(client3);
  },
  async createClient(caller, input, meta = {}) {
    const [byCode, byName] = await Promise.all([
      clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode),
      clientRepository.findByNameInOrg(caller.organizationId, input.name)
    ]);
    if (byCode) throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    if (byName) {
      throw new ConflictError(`A client named "${input.name}" already exists in this organization.`, { existingClientId: byName.id });
    }
    const client3 = await clientRepository.create({
      organizationId: caller.organizationId,
      clientCode: input.clientCode,
      name: input.name,
      legalName: input.legalName,
      status: input.status,
      email: input.email || void 0,
      phone: input.phone,
      website: input.website,
      address: input.address,
      accountManager: input.accountManager,
      notes: input.notes
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: client3.id,
      afterData: { clientCode: client3.clientCode, name: client3.name, status: client3.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return client3;
  },
  async updateClient(caller, id, input, meta = {}) {
    const existing = await loadClientInOrgOrThrow(id, caller.organizationId);
    if (input.name !== void 0 && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await clientRepository.findByNameInOrg(caller.organizationId, input.name);
      if (dup && dup.id !== id) {
        throw new ConflictError(`A client named "${input.name}" already exists in this organization.`);
      }
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.legalName !== void 0) patch.legalName = input.legalName;
    if (input.status !== void 0) patch.status = input.status;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.website !== void 0) patch.website = input.website;
    if (input.address !== void 0) patch.address = input.address;
    if (input.accountManager !== void 0) patch.accountManager = input.accountManager;
    if (input.notes !== void 0) patch.notes = input.notes;
    const updated = await clientRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_UPDATED",
      resourceType: "client",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteClient(caller, id, meta = {}) {
    await loadClientInOrgOrThrow(id, caller.organizationId);
    await clientRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ARCHIVED",
      resourceType: "client",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  async dashboardCounts(organizationId) {
    return clientRepository.countByStatus(organizationId);
  },
  async recent(organizationId, limit) {
    return clientRepository.recentForOrg(organizationId, limit);
  }
};

// server/repositories/contactRepository.ts
var contactRepository = {
  /** Org-wide contact list (Phase 5 §22's top-level "Contacts" nav item) — still tenant-scoped, optionally further scoped to one client via `filters.clientId`. */
  async listForOrg(organizationId, filters, page, limit) {
    const where = { organizationId, deletedAt: null };
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.search) {
      const term = filters.search;
      where.OR = [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } }
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { client: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.contact.count({ where })
    ]);
    return { rows, total };
  },
  async listForClient(clientId, organizationId, page, limit) {
    const where = { clientId, organizationId, deletedAt: null };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.contact.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.contact.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async findByEmailForClient(clientId, organizationId, email) {
    return prisma.contact.findFirst({
      where: { clientId, organizationId, deletedAt: null, email: { equals: email, mode: "insensitive" } }
    });
  },
  async create(data) {
    return prisma.contact.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        jobTitle: data.jobTitle,
        isPrimary: data.isPrimary ?? false
      }
    });
  },
  async update(id, data) {
    return prisma.contact.update({ where: { id }, data });
  },
  /** Unsets isPrimary on every OTHER contact for this client — called before setting a new primary, since the partial unique index (schema.prisma) allows at most one. */
  async clearPrimaryForClient(clientId, exceptContactId) {
    await prisma.contact.updateMany({
      where: { clientId, isPrimary: true, deletedAt: null, ...exceptContactId ? { id: { not: exceptContactId } } : {} },
      data: { isPrimary: false }
    });
  },
  async softDelete(id) {
    await prisma.contact.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/contactService.ts
async function loadContactInOrgOrThrow(id, organizationId) {
  const contact = await contactRepository.findByIdInOrg(id, organizationId);
  if (!contact) throw new NotFoundError("Contact not found.");
  return contact;
}
async function assertClientInOrg(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
}
var contactService = {
  async listForOrg(organizationId, filters, page, limit) {
    if (filters.clientId) await assertClientInOrg(filters.clientId, organizationId);
    return contactRepository.listForOrg(organizationId, filters, page, limit);
  },
  async listForClient(organizationId, clientId, page, limit) {
    await assertClientInOrg(clientId, organizationId);
    return contactRepository.listForClient(clientId, organizationId, page, limit);
  },
  async getContact(organizationId, id) {
    return loadContactInOrgOrThrow(id, organizationId);
  },
  async createForClient(caller, clientId, input, meta = {}) {
    await assertClientInOrg(clientId, caller.organizationId);
    const email = input.email || void 0;
    if (email) {
      const dup = await contactRepository.findByEmailForClient(clientId, caller.organizationId, email);
      if (dup) throw new ConflictError("A contact with this email already exists for this client.");
    }
    const contact = await prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.contact.updateMany({ where: { clientId, isPrimary: true, deletedAt: null }, data: { isPrimary: false } });
      }
      return tx.contact.create({
        data: {
          organizationId: caller.organizationId,
          clientId,
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone,
          jobTitle: input.jobTitle,
          isPrimary: input.isPrimary ?? false
        }
      });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_CREATED",
      resourceType: "contact",
      resourceId: contact.id,
      afterData: { clientId, firstName: contact.firstName, lastName: contact.lastName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return contact;
  },
  async updateContact(caller, id, input, meta = {}) {
    const existing = await loadContactInOrgOrThrow(id, caller.organizationId);
    if (input.email) {
      const dup = existing.clientId ? await contactRepository.findByEmailForClient(existing.clientId, caller.organizationId, input.email) : null;
      if (dup && dup.id !== id) throw new ConflictError("A contact with this email already exists for this client.");
    }
    const patch = {};
    if (input.firstName !== void 0) patch.firstName = input.firstName;
    if (input.lastName !== void 0) patch.lastName = input.lastName;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.jobTitle !== void 0) patch.jobTitle = input.jobTitle;
    if (input.status !== void 0) patch.status = input.status;
    const updated = await prisma.$transaction(async (tx) => {
      if (input.isPrimary !== void 0) {
        if (input.isPrimary && existing.clientId) {
          await tx.contact.updateMany({
            where: { clientId: existing.clientId, isPrimary: true, deletedAt: null, id: { not: id } },
            data: { isPrimary: false }
          });
        }
        patch.isPrimary = input.isPrimary;
      }
      return tx.contact.update({ where: { id }, data: patch });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_UPDATED",
      resourceType: "contact",
      resourceId: id,
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteContact(caller, id, meta = {}) {
    await loadContactInOrgOrThrow(id, caller.organizationId);
    await contactRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_DELETED",
      resourceType: "contact",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/onboardingSchemas.ts
import { z as z8 } from "zod";
var ONBOARDING_CHECKLIST_KEYS = [
  "CLIENT_VERIFIED",
  "WORKSPACE_CREATED",
  "PRIMARY_CONTACT_CONFIRMED",
  "ADMINISTRATOR_INVITED",
  "ADMINISTRATOR_ACCEPTED",
  "WORKSPACE_CONFIGURED",
  "ONBOARDING_COMPLETED"
];
var listOnboardingQuerySchema = z8.object({
  page: z8.coerce.number().int().positive().default(1),
  limit: z8.coerce.number().int().positive().max(100).default(20),
  status: z8.enum(["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]).optional(),
  search: z8.string().trim().max(200).optional()
});
var updateOnboardingSchema = z8.object({
  completeStep: z8.enum(ONBOARDING_CHECKLIST_KEYS).optional(),
  status: z8.enum(["CANCELLED"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/repositories/clientOnboardingRepository.ts
var STEP_LABELS = {
  CLIENT_VERIFIED: "Client verified",
  WORKSPACE_CREATED: "Workspace created",
  PRIMARY_CONTACT_CONFIRMED: "Primary contact confirmed",
  ADMINISTRATOR_INVITED: "Administrator invited",
  ADMINISTRATOR_ACCEPTED: "Administrator accepted",
  WORKSPACE_CONFIGURED: "Workspace configured",
  ONBOARDING_COMPLETED: "Onboarding completed"
};
function freshChecklist() {
  return ONBOARDING_CHECKLIST_KEYS.map((key) => ({
    key,
    label: STEP_LABELS[key],
    completed: false,
    completedAt: null,
    completedById: null
  }));
}
function nextIncompleteStep(checklist) {
  return checklist.find((item) => !item.completed)?.key ?? null;
}
function buildWhere3(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.client = { name: { contains: filters.search, mode: "insensitive" } };
  }
  return where;
}
var clientOnboardingRepository = {
  async list(organizationId, filters, page, limit) {
    const where = buildWhere3(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.clientOnboarding.findMany({
        where,
        include: { client: { include: { workspaceOrganization: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.clientOnboarding.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.clientOnboarding.findFirst({
      where: { id, organizationId },
      include: { client: { include: { workspaceOrganization: true } } }
    });
  },
  async findByClientId(clientId) {
    return prisma.clientOnboarding.findUnique({ where: { clientId } });
  },
  async create(data) {
    return prisma.clientOnboarding.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        createdById: data.createdById,
        status: "IN_PROGRESS",
        startedAt: /* @__PURE__ */ new Date(),
        checklist: freshChecklist(),
        currentStep: freshChecklist()[0].key
      }
    });
  },
  async update(id, data) {
    return prisma.clientOnboarding.update({ where: { id }, data });
  }
};

// server/services/onboardingService.ts
var TERMINAL_STATUSES2 = /* @__PURE__ */ new Set(["COMPLETED", "CANCELLED"]);
async function loadClientInOrgOrThrow2(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
async function loadOnboardingInOrgOrThrow(id, organizationId) {
  const record = await clientOnboardingRepository.findByIdInOrg(id, organizationId);
  if (!record) throw new NotFoundError("Onboarding record not found.");
  return record;
}
var onboardingService = {
  async listOnboarding(organizationId, filters, page, limit) {
    return clientOnboardingRepository.list(organizationId, filters, page, limit);
  },
  async getOnboarding(organizationId, id) {
    return loadOnboardingInOrgOrThrow(id, organizationId);
  },
  async getOnboardingForClient(organizationId, clientId) {
    await loadClientInOrgOrThrow2(clientId, organizationId);
    return clientOnboardingRepository.findByClientId(clientId);
  },
  async startOnboarding(caller, clientId, meta = {}) {
    await loadClientInOrgOrThrow2(clientId, caller.organizationId);
    const existing = await clientOnboardingRepository.findByClientId(clientId);
    if (existing) {
      throw new ConflictError("Onboarding has already been started for this client.", { onboardingId: existing.id });
    }
    const record = await clientOnboardingRepository.create({
      organizationId: caller.organizationId,
      clientId,
      createdById: caller.id
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_STARTED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { clientId, status: record.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return record;
  },
  async updateOnboarding(caller, id, input, meta = {}) {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (TERMINAL_STATUSES2.has(existing.status)) {
      throw new ConflictError(`This onboarding is already ${existing.status.toLowerCase()} and can no longer be changed.`);
    }
    if (input.status === "CANCELLED") {
      const updated = await clientOnboardingRepository.update(id, { status: "CANCELLED", cancelledAt: /* @__PURE__ */ new Date() });
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "CLIENT_ONBOARDING_CANCELLED",
        resourceType: "client_onboarding",
        resourceId: id,
        beforeData: { status: existing.status },
        afterData: { status: "CANCELLED" },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
      return updated;
    }
    if (input.completeStep) {
      return this.completeStep(caller, id, input.completeStep, meta);
    }
    return existing;
  },
  /**
   * Marks one checklist step complete (idempotent — re-completing an
   * already-complete step is a no-op, not an error, since both manual PATCH
   * calls and automatic calls from workspaceService/invitationService can
   * race to mark the same step). Advances currentStep; flips status to
   * READY once every step is done — completion itself is a separate,
   * explicit action (completeOnboarding), never inferred (§7).
   */
  async completeStep(caller, onboardingId, step, meta = {}) {
    const record = await loadOnboardingInOrgOrThrow(onboardingId, caller.organizationId);
    if (TERMINAL_STATUSES2.has(record.status)) return record;
    const checklist = record.checklist ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item) throw new ValidationError(`Unknown onboarding step: ${step}`);
    if (item.completed) return record;
    item.completed = true;
    item.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    item.completedById = caller.id;
    const next = nextIncompleteStep(checklist);
    const updated = await clientOnboardingRepository.update(record.id, {
      checklist,
      currentStep: next,
      status: next === null ? "READY" : record.status
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step, status: updated.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  /** Marks a step complete by clientId — used by workspaceService/invitationService, which know the client, not the onboarding record id. Silently no-ops if onboarding was never started for this client (starting onboarding is optional before provisioning). */
  async completeStepForClient(clientId, step, actorUserId) {
    const record = await clientOnboardingRepository.findByClientId(clientId);
    if (!record) return;
    const checklist = record.checklist ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item || item.completed) return;
    item.completed = true;
    item.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    item.completedById = actorUserId ?? null;
    const next = nextIncompleteStep(checklist);
    await clientOnboardingRepository.update(record.id, {
      checklist,
      currentStep: next,
      status: next === null ? "READY" : record.status
    });
    await auditLogRepository.record({
      organizationId: record.organizationId,
      actorUserId,
      actorType: actorUserId ? "USER" : "SYSTEM",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step }
    });
  },
  async completeOnboarding(caller, id, meta = {}) {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (existing.status === "COMPLETED") {
      throw new ConflictError("This onboarding has already been completed.");
    }
    if (existing.status !== "READY") {
      throw new ValidationError("Complete every checklist step before finishing onboarding.");
    }
    const updated = await clientOnboardingRepository.update(id, {
      status: "COMPLETED",
      completedAt: /* @__PURE__ */ new Date(),
      completedBy: { connect: { id: caller.id } }
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: id,
      afterData: { status: "COMPLETED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  }
};

// server/repositories/workspaceRepository.ts
function slugify2(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
function buildWhere4(ownerOrganizationId, filters) {
  const where = {
    provisionedForClient: { organizationId: ownerOrganizationId }
  };
  if (filters.status) where.status = filters.status;
  if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };
  return where;
}
var workspaceRepository = {
  async list(ownerOrganizationId, filters, page, limit) {
    const where = buildWhere4(ownerOrganizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: { provisionedForClient: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.organization.count({ where })
    ]);
    return { rows, total };
  },
  /** The single ownership-scoped lookup method — a workspace id belonging to another tenant's CRM is invisible, not just filtered client-side. */
  async findByIdForOwner(id, ownerOrganizationId) {
    return prisma.organization.findFirst({
      where: { id, provisionedForClient: { organizationId: ownerOrganizationId } },
      include: { provisionedForClient: true }
    });
  },
  async findUniqueSlug(baseName) {
    const baseSlug = slugify2(baseName) || "workspace";
    let slug = baseSlug;
    let attempt = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async update(id, data) {
    return prisma.organization.update({ where: { id }, data });
  },
  async countMembers(organizationId) {
    return prisma.organizationMembership.count({ where: { organizationId } });
  }
};

// server/services/workspaceService.ts
import { Prisma as Prisma2 } from "@prisma/client";
var SENSITIVE_STATUSES = /* @__PURE__ */ new Set(["SUSPENDED", "ARCHIVED"]);
var ALLOWED_TRANSITIONS = {
  TRIAL: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: []
};
function assertValidWorkspaceTransition(current, next) {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictError(`Workspace cannot move from ${current} to ${next}.`);
  }
}
async function loadClientInOrgOrThrow3(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
async function loadWorkspaceForOwnerOrThrow(id, ownerOrganizationId) {
  const workspace = await workspaceRepository.findByIdForOwner(id, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}
var workspaceService = {
  async listWorkspaces(ownerOrganizationId, filters, page, limit) {
    return workspaceRepository.list(ownerOrganizationId, filters, page, limit);
  },
  async getWorkspace(ownerOrganizationId, id) {
    return loadWorkspaceForOwnerOrThrow(id, ownerOrganizationId);
  },
  /**
   * The core transactional provisioning operation (§13). Idempotency/
   * concurrency (§14/§15): if the client is already provisioned, this
   * throws a 409 rather than creating a second workspace; a conditional
   * `updateMany` inside the transaction (mirroring leadService.convertLead)
   * guards against two concurrent provisioning requests for the same
   * client both succeeding — the loser's transaction rolls back entirely,
   * including the Organization row it just created.
   */
  async provisionWorkspace(caller, clientId, input, meta = {}) {
    const client3 = await loadClientInOrgOrThrow3(clientId, caller.organizationId);
    if (client3.workspaceOrganizationId) {
      throw new ConflictError("This client has already been provisioned into a workspace.", {
        workspaceOrganizationId: client3.workspaceOrganizationId
      });
    }
    const name = input.name?.trim() || client3.name;
    const slug = await workspaceRepository.findUniqueSlug(name);
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const workspace = await tx.organization.create({
          data: {
            name,
            slug,
            type: "CLIENT",
            tier: "GROWTH",
            status: "TRIAL",
            // PENDING — see module doc comment
            timezone: input.timezone ?? "UTC",
            currency: input.currency ?? "USD",
            locale: input.locale ?? "en"
          }
        });
        const linked = await tx.client.updateMany({
          where: { id: clientId, organizationId: caller.organizationId, workspaceOrganizationId: null },
          data: { workspaceOrganizationId: workspace.id }
        });
        if (linked.count !== 1) {
          throw new ConflictError("This client has already been provisioned into a workspace.");
        }
        let onboarding = await tx.clientOnboarding.findUnique({ where: { clientId } });
        if (!onboarding) {
          onboarding = await tx.clientOnboarding.create({
            data: {
              organizationId: caller.organizationId,
              clientId,
              createdById: caller.id,
              status: "IN_PROGRESS",
              startedAt: /* @__PURE__ */ new Date(),
              checklist: freshChecklist(),
              currentStep: "CLIENT_VERIFIED"
            }
          });
        }
        return { workspace, onboardingStarted: !!onboarding };
      });
    } catch (err) {
      if (err instanceof Prisma2.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This client has already been provisioned into a workspace.");
      }
      throw err;
    }
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "WORKSPACE_PROVISIONED",
      resourceType: "organization",
      resourceId: result.workspace.id,
      afterData: { clientId, name: result.workspace.name, status: result.workspace.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await onboardingService.completeStepForClient(clientId, "WORKSPACE_CREATED", caller.id);
    return result.workspace;
  },
  async updateWorkspace(caller, id, input, callerPermissions, meta = {}) {
    const existing = await loadWorkspaceForOwnerOrThrow(id, caller.organizationId);
    if (input.status !== void 0) {
      assertValidWorkspaceTransition(existing.status, input.status);
      if (SENSITIVE_STATUSES.has(input.status) && !callerPermissions.includes("workspaces.suspend") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "workspaces.suspend"');
      }
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.website !== void 0) patch.website = input.website;
    if (input.address !== void 0) patch.address = input.address;
    if (input.timezone !== void 0) patch.timezone = input.timezone;
    if (input.currency !== void 0) patch.currency = input.currency;
    if (input.locale !== void 0) patch.locale = input.locale;
    if (input.status !== void 0) patch.status = input.status;
    const updated = await workspaceRepository.update(id, patch);
    const action = input.status === "SUSPENDED" ? "WORKSPACE_SUSPENDED" : input.status === "ARCHIVED" ? "WORKSPACE_DEACTIVATED" : "WORKSPACE_UPDATED";
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action,
      resourceType: "organization",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (input.name !== void 0 || Object.keys(patch).some((k) => ["timezone", "currency", "locale", "email", "phone", "address"].includes(k))) {
      await onboardingService.completeStepForClient(existing.provisionedForClient.id, "WORKSPACE_CONFIGURED", caller.id);
    }
    return updated;
  },
  async listMembers(caller, workspaceId, page, limit) {
    await loadWorkspaceForOwnerOrThrow(workspaceId, caller.organizationId);
    return organizationMembershipRepository.listForOrganization(workspaceId, page, limit);
  }
};

// server/schemas/clientSchemas.ts
import { z as z9 } from "zod";
var clientStatusSchema = z9.enum(["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]);
var listClientsQuerySchema = z9.object({
  page: z9.coerce.number().int().positive().default(1),
  limit: z9.coerce.number().int().positive().max(100).default(20),
  search: z9.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  sort: z9.enum(["createdAt", "updatedAt", "name", "status"]).default("createdAt"),
  order: z9.enum(["asc", "desc"]).default("desc")
});
var createClientSchema = z9.object({
  clientCode: z9.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z9.string().trim().min(1).max(200),
  legalName: z9.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  email: z9.string().trim().email().max(255).optional().or(z9.literal("")),
  phone: z9.string().trim().max(50).optional(),
  website: z9.string().trim().max(255).optional(),
  address: z9.string().trim().max(500).optional(),
  accountManager: z9.string().trim().uuid().optional(),
  notes: z9.string().trim().max(5e3).optional()
});
var updateClientSchema = z9.object({
  name: z9.string().trim().min(1).max(200).optional(),
  legalName: z9.string().trim().max(200).nullable().optional(),
  status: clientStatusSchema.optional(),
  email: z9.string().trim().email().max(255).nullable().optional().or(z9.literal("")),
  phone: z9.string().trim().max(50).nullable().optional(),
  website: z9.string().trim().max(255).nullable().optional(),
  address: z9.string().trim().max(500).nullable().optional(),
  accountManager: z9.string().trim().uuid().nullable().optional(),
  notes: z9.string().trim().max(5e3).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/contactSchemas.ts
import { z as z10 } from "zod";
var listContactsQuerySchema = z10.object({
  page: z10.coerce.number().int().positive().default(1),
  limit: z10.coerce.number().int().positive().max(100).default(20)
});
var listAllContactsQuerySchema = z10.object({
  page: z10.coerce.number().int().positive().default(1),
  limit: z10.coerce.number().int().positive().max(100).default(20),
  search: z10.string().trim().max(200).optional(),
  clientId: z10.string().trim().uuid().optional()
});
var createContactSchema = z10.object({
  firstName: z10.string().trim().min(1).max(100),
  lastName: z10.string().trim().min(1).max(100),
  email: z10.string().trim().email().max(255).optional().or(z10.literal("")),
  phone: z10.string().trim().max(50).optional(),
  jobTitle: z10.string().trim().max(150).optional(),
  isPrimary: z10.boolean().optional()
});
var updateContactSchema = z10.object({
  firstName: z10.string().trim().min(1).max(100).optional(),
  lastName: z10.string().trim().min(1).max(100).optional(),
  email: z10.string().trim().email().max(255).nullable().optional().or(z10.literal("")),
  phone: z10.string().trim().max(50).nullable().optional(),
  jobTitle: z10.string().trim().max(150).nullable().optional(),
  isPrimary: z10.boolean().optional(),
  status: z10.enum(["ACTIVE", "INACTIVE"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/workspaceSchemas.ts
import { z as z11 } from "zod";
var workspaceStatusSchema = z11.enum(["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
var listWorkspacesQuerySchema = z11.object({
  page: z11.coerce.number().int().positive().default(1),
  limit: z11.coerce.number().int().positive().max(100).default(20),
  status: workspaceStatusSchema.optional(),
  search: z11.string().trim().max(200).optional()
});
var provisionWorkspaceSchema = z11.object({
  name: z11.string().trim().min(1).max(200).optional(),
  timezone: z11.string().trim().min(1).max(100).optional(),
  currency: z11.string().trim().length(3).regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").optional(),
  locale: z11.string().trim().min(2).max(20).optional()
});
var updateWorkspaceSchema = z11.object({
  name: z11.string().trim().min(1).max(200).optional(),
  email: z11.string().trim().email().max(255).nullable().optional().or(z11.literal("")),
  phone: z11.string().trim().max(50).nullable().optional(),
  website: z11.string().trim().max(255).nullable().optional(),
  address: z11.string().trim().max(500).nullable().optional(),
  timezone: z11.string().trim().min(1).max(100).optional(),
  currency: z11.string().trim().length(3).regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").optional(),
  locale: z11.string().trim().min(2).max(20).optional(),
  status: workspaceStatusSchema.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/clientRoutes.ts
var router10 = Router10();
router10.use(authenticateToken);
function requestMeta3(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router10.get(
  "/",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const query = listClientsQuerySchema.parse(req.query);
    const { rows, total } = await clientService.listClients(
      req.user.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { clients: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router10.get(
  "/:id",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const client3 = await clientService.getClient(req.user.organizationId, req.params.id);
    sendSuccess(res, { client: client3 });
  })
);
router10.post(
  "/",
  requirePermission("clients.create"),
  asyncHandler(async (req, res) => {
    const input = createClientSchema.parse(req.body);
    const client3 = await clientService.createClient(req.user, input, requestMeta3(req));
    sendSuccess(res, { client: client3 }, 201);
  })
);
router10.patch(
  "/:id",
  requirePermission("clients.update"),
  asyncHandler(async (req, res) => {
    const input = updateClientSchema.parse(req.body);
    const client3 = await clientService.updateClient(req.user, req.params.id, input, requestMeta3(req));
    sendSuccess(res, { client: client3 });
  })
);
router10.delete(
  "/:id",
  requirePermission("clients.delete"),
  asyncHandler(async (req, res) => {
    await clientService.deleteClient(req.user, req.params.id, requestMeta3(req));
    sendSuccess(res, { message: "Client archived." });
  })
);
router10.get(
  "/:clientId/contacts",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForClient(req.user.organizationId, req.params.clientId, query.page, query.limit);
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router10.post(
  "/:clientId/contacts",
  requirePermission("contacts.create"),
  asyncHandler(async (req, res) => {
    const input = createContactSchema.parse(req.body);
    const contact = await contactService.createForClient(req.user, req.params.clientId, input, requestMeta3(req));
    sendSuccess(res, { contact }, 201);
  })
);
router10.post(
  "/:clientId/onboarding/start",
  requirePermission("onboarding.create"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.startOnboarding(req.user, req.params.clientId, requestMeta3(req));
    sendSuccess(res, { onboarding: record }, 201);
  })
);
router10.get(
  "/:clientId/onboarding",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboardingForClient(req.user.organizationId, req.params.clientId);
    sendSuccess(res, { onboarding: record });
  })
);
router10.post(
  "/:clientId/workspace/provision",
  requirePermission("workspaces.create"),
  asyncHandler(async (req, res) => {
    const input = provisionWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.provisionWorkspace(req.user, req.params.clientId, input, requestMeta3(req));
    sendSuccess(res, { workspace }, 201);
  })
);
var clientRoutes_default = router10;

// server/routes/v1/contactRoutes.ts
import { Router as Router11 } from "express";
var router11 = Router11();
router11.use(authenticateToken);
function requestMeta4(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router11.get(
  "/",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listAllContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForOrg(
      req.user.organizationId,
      { search: query.search, clientId: query.clientId },
      query.page,
      query.limit
    );
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router11.get(
  "/:id",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const contact = await contactService.getContact(req.user.organizationId, req.params.id);
    sendSuccess(res, { contact });
  })
);
router11.patch(
  "/:id",
  requirePermission("contacts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContactSchema.parse(req.body);
    const contact = await contactService.updateContact(req.user, req.params.id, input, requestMeta4(req));
    sendSuccess(res, { contact });
  })
);
router11.delete(
  "/:id",
  requirePermission("contacts.delete"),
  asyncHandler(async (req, res) => {
    await contactService.deleteContact(req.user, req.params.id, requestMeta4(req));
    sendSuccess(res, { message: "Contact removed." });
  })
);
var contactRoutes_default = router11;

// server/routes/v1/crmRoutes.ts
import { Router as Router12 } from "express";
var router12 = Router12();
router12.use(authenticateToken);
router12.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions;
    const organizationId = req.user.organizationId;
    const [leadCounts, leadRecent, clientCounts, clientRecent] = await Promise.all([
      permissions.includes("leads.read") ? leadService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("leads.read") ? leadService.recent(organizationId, 5) : Promise.resolve([]),
      permissions.includes("clients.read") ? clientService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("clients.read") ? clientService.recent(organizationId, 5) : Promise.resolve([])
    ]);
    sendSuccess(res, {
      leads: leadCounts && {
        total: Object.values(leadCounts).reduce((a, b) => a + b, 0),
        new: leadCounts.NEW ?? 0,
        contacted: leadCounts.CONTACTED ?? 0,
        qualified: leadCounts.QUALIFIED ?? 0,
        converted: leadCounts.CONVERTED ?? 0,
        lost: leadCounts.LOST ?? 0,
        recent: leadRecent
      },
      clients: clientCounts && {
        total: Object.values(clientCounts).reduce((a, b) => a + b, 0),
        prospect: clientCounts.PROSPECT ?? 0,
        active: clientCounts.ACTIVE ?? 0,
        inactive: clientCounts.INACTIVE ?? 0,
        suspended: clientCounts.SUSPENDED ?? 0,
        archived: clientCounts.ARCHIVED ?? 0,
        recent: clientRecent
      }
    });
  })
);
var crmRoutes_default = router12;

// server/routes/v1/onboardingRoutes.ts
import { Router as Router13 } from "express";
var router13 = Router13();
router13.use(authenticateToken);
function requestMeta5(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router13.get(
  "/",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const query = listOnboardingQuerySchema.parse(req.query);
    const { rows, total } = await onboardingService.listOnboarding(
      req.user.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { onboarding: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router13.get(
  "/:id",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboarding(req.user.organizationId, req.params.id);
    sendSuccess(res, { onboarding: record });
  })
);
router13.patch(
  "/:id",
  requirePermission("onboarding.update"),
  asyncHandler(async (req, res) => {
    const input = updateOnboardingSchema.parse(req.body);
    const record = await onboardingService.updateOnboarding(req.user, req.params.id, input, requestMeta5(req));
    sendSuccess(res, { onboarding: record });
  })
);
router13.post(
  "/:id/complete",
  requirePermission("onboarding.complete"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.completeOnboarding(req.user, req.params.id, requestMeta5(req));
    sendSuccess(res, { onboarding: record });
  })
);
var onboardingRoutes_default = router13;

// server/routes/v1/workspaceRoutes.ts
import { Router as Router14 } from "express";

// server/repositories/workspaceInvitationRepository.ts
var workspaceInvitationRepository = {
  async create(data) {
    return prisma.workspaceInvitation.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        roleId: data.roleId,
        tokenHash: hashToken(data.token),
        expiresAt: data.expiresAt,
        invitedById: data.invitedById
      }
    });
  },
  /** Invalidates any prior outstanding invitation for the same (organization, email) — at most one usable credential at a time, mirroring passwordResetRepository.invalidateAllForUser. */
  async revokePendingForEmail(organizationId, email) {
    await prisma.workspaceInvitation.updateMany({
      where: { organizationId, email: email.trim().toLowerCase(), acceptedAt: null, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.workspaceInvitation.findFirst({ where: { id, organizationId } });
  },
  /** No organization filter — callers must separately verify the invitation's workspace (organizationId) belongs to their tenant via workspaceRepository.findByIdForOwner, since an invitation's own organizationId IS the workspace id, not the caller's CRM-owning org. */
  async findById(id) {
    return prisma.workspaceInvitation.findUnique({ where: { id } });
  },
  async findByToken(token) {
    return prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: true, role: true }
    });
  },
  async list(organizationId, page, limit) {
    const where = { organizationId };
    const [rows, total] = await Promise.all([
      prisma.workspaceInvitation.findMany({
        where,
        include: {
          role: { select: { key: true, name: true } },
          invitedBy: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.workspaceInvitation.count({ where })
    ]);
    return { rows, total };
  },
  async revoke(id) {
    await prisma.workspaceInvitation.update({ where: { id }, data: { revokedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/invitationService.ts
import { Prisma as Prisma3 } from "@prisma/client";
var CLIENT_ADMIN_ROLE_KEY = "ADMIN";
function computeInvitationStatus(invite) {
  if (invite.acceptedAt) return "ACCEPTED";
  if (invite.revokedAt) return "REVOKED";
  if (invite.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "PENDING";
}
async function loadWorkspaceForOwnerOrThrow2(workspaceId, ownerOrganizationId) {
  const workspace = await workspaceRepository.findByIdForOwner(workspaceId, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}
var invitationService = {
  async listInvitations(caller, workspaceId, page, limit) {
    await loadWorkspaceForOwnerOrThrow2(workspaceId, caller.organizationId);
    const { rows, total } = await workspaceInvitationRepository.list(workspaceId, page, limit);
    return {
      rows: rows.map((r) => {
        const { tokenHash: _tokenHash, ...safe } = r;
        return { ...safe, status: computeInvitationStatus(r) };
      }),
      total
    };
  },
  async createInvitation(caller, workspaceId, input, meta = {}) {
    const workspace = await loadWorkspaceForOwnerOrThrow2(workspaceId, caller.organizationId);
    const adminRole = await roleRepository.findByKey(CLIENT_ADMIN_ROLE_KEY);
    if (!adminRole) throw new InternalError("Required role configuration is missing.");
    const email = input.email.trim().toLowerCase();
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + config.invitationTokenTtlHours * 60 * 60 * 1e3);
    const invitation = await prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.updateMany({
        where: { organizationId: workspace.id, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: /* @__PURE__ */ new Date() }
      });
      return tx.workspaceInvitation.create({
        data: {
          organizationId: workspace.id,
          email,
          roleId: adminRole.id,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById: caller.id
        }
      });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      afterData: { workspaceId: workspace.id, email, roleKey: CLIENT_ADMIN_ROLE_KEY },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (workspace.provisionedForClient) {
      await onboardingService.completeStepForClient(workspace.provisionedForClient.id, "ADMINISTRATOR_INVITED", caller.id);
    }
    return { invitation, devToken: config.isProduction ? void 0 : token };
  },
  async revokeInvitation(caller, invitationId, meta = {}) {
    const invitation = await workspaceInvitationRepository.findById(invitationId);
    const workspace = invitation ? await workspaceRepository.findByIdForOwner(invitation.organizationId, caller.organizationId) : null;
    if (!invitation || !workspace) throw new NotFoundError("Invitation not found.");
    const status = computeInvitationStatus(invitation);
    if (status !== "PENDING") {
      throw new ConflictError(`This invitation is already ${status.toLowerCase()} and cannot be revoked.`);
    }
    await workspaceInvitationRepository.revoke(invitationId);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITATION_REVOKED",
      resourceType: "workspace_invitation",
      resourceId: invitationId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /** Public, unauthenticated lookup for the acceptance page (§26) — returns only what's needed to render a safe form, never the token hash or workspace internals. */
  async previewInvitation(token) {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new NotFoundError("This invitation link is invalid or has expired.");
    }
    const existingUser = await userRepository.findByEmail(invitation.email);
    return {
      email: invitation.email,
      workspaceName: invitation.organization.name,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt,
      requiresPassword: !existingUser
    };
  },
  /** Transactional acceptance (§21) — race-safe against double-acceptance via a conditional updateMany, same TOCTOU-guard pattern as leadService.convertLead. */
  async acceptInvitation(token, input, meta = {}) {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new AuthenticationError("This invitation link is invalid or has expired.");
    }
    const existingUser = await userRepository.findByEmail(invitation.email);
    if (!existingUser && !input.password) {
      throw new ValidationError("A password is required to create your account.");
    }
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        let user = existingUser;
        if (!user) {
          const passwordHash = await hashPassword(input.password);
          user = await tx.user.create({
            data: {
              organizationId: invitation.organizationId,
              email: invitation.email,
              passwordHash,
              firstName: input.firstName?.trim() || "Workspace",
              lastName: input.lastName?.trim() || "Administrator",
              displayName: `${input.firstName?.trim() || "Workspace"} ${input.lastName?.trim() || "Administrator"}`.trim(),
              title: "Workspace Administrator",
              roleId: invitation.roleId
            }
          });
        }
        const existingMembership = await tx.organizationMembership.findUnique({
          where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } }
        });
        if (!existingMembership) {
          await tx.organizationMembership.create({
            data: {
              userId: user.id,
              organizationId: invitation.organizationId,
              roleId: invitation.roleId,
              status: "ACTIVE",
              isPrimary: !existingUser
            }
          });
        }
        const accepted = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: /* @__PURE__ */ new Date(), acceptedUserId: user.id }
        });
        if (accepted.count !== 1) {
          throw new ConflictError("This invitation has already been accepted.");
        }
        return user;
      });
    } catch (err) {
      if (err instanceof Prisma3.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This invitation has already been accepted.");
      }
      throw err;
    }
    if (!result) throw new InternalError("Invitation acceptance did not resolve a user.");
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1e3);
    await sessionRepository.create({
      token: sessionToken,
      userId: result.id,
      organizationId: invitation.organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const role = await roleRepository.resolveById(invitation.roleId);
    if (!role) throw new InternalError("Role could not be resolved.");
    const sanitized = sanitizeUser({ ...result, organizationId: invitation.organizationId }, role);
    await auditLogRepository.record({
      organizationId: invitation.organizationId,
      actorUserId: result.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_ACCEPTED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const client3 = await prisma.client.findUnique({ where: { workspaceOrganizationId: invitation.organizationId } });
    if (client3) {
      await onboardingService.completeStepForClient(client3.id, "ADMINISTRATOR_ACCEPTED", result.id);
    }
    return { session: { token: sessionToken, expiresAt }, user: sanitized };
  }
};

// server/schemas/invitationSchemas.ts
import { z as z12 } from "zod";
var createInvitationSchema = z12.object({
  email: z12.string().trim().min(1).email()
});
var listInvitationsQuerySchema = z12.object({
  page: z12.coerce.number().int().positive().default(1),
  limit: z12.coerce.number().int().positive().max(100).default(20)
});
var newPasswordSchema3 = z12.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z12.ZodIssueCode.custom, message: issue });
});
var acceptInvitationSchema = z12.object({
  firstName: z12.string().trim().min(1).max(100).optional(),
  lastName: z12.string().trim().min(1).max(100).optional(),
  password: newPasswordSchema3.optional()
});

// server/routes/v1/workspaceRoutes.ts
var router14 = Router14();
router14.use(authenticateToken);
function requestMeta6(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router14.get(
  "/",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.parse(req.query);
    const { rows, total } = await workspaceService.listWorkspaces(
      req.user.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { workspaces: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.get(
  "/:id",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const workspace = await workspaceService.getWorkspace(req.user.organizationId, req.params.id);
    sendSuccess(res, { workspace });
  })
);
router14.patch(
  "/:id",
  requirePermission("workspaces.update"),
  asyncHandler(async (req, res) => {
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.updateWorkspace(req.user, req.params.id, input, req.user.role.permissions, requestMeta6(req));
    sendSuccess(res, { workspace });
  })
);
router14.get(
  "/:id/members",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.pick({ page: true, limit: true }).parse(req.query);
    const { rows, total } = await workspaceService.listMembers(req.user, req.params.id, query.page, query.limit);
    const members = rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName,
      status: m.status,
      isPrimary: m.isPrimary,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt
    }));
    sendSuccess(res, { members }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.get(
  "/:id/invitations",
  requirePermission("invitations.read"),
  asyncHandler(async (req, res) => {
    const query = listInvitationsQuerySchema.parse(req.query);
    const { rows, total } = await invitationService.listInvitations(req.user, req.params.id, query.page, query.limit);
    sendSuccess(res, { invitations: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.post(
  "/:id/invitations",
  requirePermission("invitations.create"),
  asyncHandler(async (req, res) => {
    const input = createInvitationSchema.parse(req.body);
    const { invitation, devToken } = await invitationService.createInvitation(req.user, req.params.id, input, requestMeta6(req));
    const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
    sendSuccess(res, { invitation: safeInvitation, devToken }, 201);
  })
);
var workspaceRoutes_default = router14;

// server/routes/v1/invitationRoutes.ts
import { Router as Router15 } from "express";
var router15 = Router15();
function requestMeta7(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router15.post(
  "/:id/revoke",
  authenticateToken,
  requirePermission("invitations.revoke"),
  asyncHandler(async (req, res) => {
    await invitationService.revokeInvitation(req.user, req.params.id, requestMeta7(req));
    sendSuccess(res, { message: "Invitation revoked." });
  })
);
router15.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const preview = await invitationService.previewInvitation(req.params.token);
    sendSuccess(res, preview);
  })
);
router15.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const input = acceptInvitationSchema.parse(req.body);
    const result = await invitationService.acceptInvitation(req.params.token, input, requestMeta7(req));
    sendSuccess(res, result, 201);
  })
);
var invitationRoutes_default = router15;

// server/routes/v1/productRoutes.ts
import { Router as Router16 } from "express";

// server/repositories/productRepository.ts
function slugify3(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);
}
function buildWhere5(filters) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.isFeatured !== void 0) where.isFeatured = filters.isFeatured;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { code: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var productRepository = {
  async list(filters, page, limit, sort, order) {
    const where = buildWhere5(filters);
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.product.count({ where })
    ]);
    return { rows, total };
  },
  async findById(id) {
    return prisma.product.findUnique({ where: { id } });
  },
  async findByCode(code) {
    return prisma.product.findUnique({ where: { code } });
  },
  async findBySlug(slug) {
    return prisma.product.findUnique({ where: { slug } });
  },
  /** Server-generated, collision-safe (§7) — never trusts a frontend-supplied slug for uniqueness beyond a caller-requested starting point. */
  async findUniqueSlug(base) {
    const baseSlug = slugify3(base) || "product";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async create(data) {
    return prisma.product.create({
      data: {
        code: data.code,
        name: data.name,
        slug: data.slug,
        type: data.type,
        shortDescription: data.shortDescription,
        description: data.description,
        status: data.status ?? "DRAFT",
        isFeatured: data.isFeatured ?? false,
        displayOrder: data.displayOrder ?? 0,
        createdById: data.createdById,
        updatedById: data.createdById
      }
    });
  },
  async update(id, data) {
    return prisma.product.update({ where: { id }, data });
  }
};

// server/services/productService.ts
var TERMINAL_STATUSES3 = /* @__PURE__ */ new Set(["ARCHIVED"]);
var ALLOWED_TRANSITIONS2 = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: []
};
function assertValidTransition2(current, next) {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS2[current]?.includes(next)) {
    throw new ConflictError(`Product cannot move from ${current} to ${next}.`);
  }
}
async function loadProductOrThrow(id) {
  const product = await productRepository.findById(id);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}
var productService = {
  async listProducts(filters, page, limit, sort, order) {
    return productRepository.list(filters, page, limit, sort, order);
  },
  async getProduct(id) {
    return loadProductOrThrow(id);
  },
  async createProduct(caller, input, meta = {}) {
    const existingCode = await productRepository.findByCode(input.code);
    if (existingCode) throw new ConflictError(`A product with code "${input.code}" already exists.`, { existingProductId: existingCode.id });
    let slug;
    if (input.slug) {
      const existingSlug = await productRepository.findBySlug(input.slug);
      if (existingSlug) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: existingSlug.id });
      slug = input.slug;
    } else {
      slug = await productRepository.findUniqueSlug(input.name);
    }
    let product;
    try {
      product = await productRepository.create({
        code: input.code,
        name: input.name,
        slug,
        type: input.type,
        shortDescription: input.shortDescription,
        description: input.description,
        status: input.status,
        isFeatured: input.isFeatured,
        displayOrder: input.displayOrder,
        createdById: caller.id
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this code or slug already exists.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CREATED",
      resourceType: "product",
      resourceId: product.id,
      afterData: { code: product.code, name: product.name, type: product.type, status: product.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return product;
  },
  async updateProduct(caller, id, input, meta = {}) {
    const existing = await loadProductOrThrow(id);
    if (TERMINAL_STATUSES3.has(existing.status)) {
      throw new ConflictError("This product is archived and can no longer be edited.");
    }
    if (input.status !== void 0) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError('Use POST /products/:id/archive to archive a product \u2014 status cannot be set to "ARCHIVED" directly.');
      }
      assertValidTransition2(existing.status, input.status);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await productRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.type !== void 0) patch.type = input.type;
    if (input.shortDescription !== void 0) patch.shortDescription = input.shortDescription;
    if (input.description !== void 0) patch.description = input.description;
    if (input.status !== void 0) patch.status = input.status;
    if (input.isFeatured !== void 0) patch.isFeatured = input.isFeatured;
    if (input.displayOrder !== void 0) patch.displayOrder = input.displayOrder;
    patch.updatedById = caller.id;
    let updated;
    try {
      updated = await productRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_UPDATED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async archiveProduct(caller, id, meta = {}) {
    const existing = await loadProductOrThrow(id);
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("This product is already archived.");
    }
    const archived = await productRepository.update(id, { status: "ARCHIVED", updatedBy: { connect: { id: caller.id } } });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_ARCHIVED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return archived;
  }
};
function isUniqueConstraintError(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}

// server/repositories/productModuleRepository.ts
function slugify4(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);
}
var productModuleRepository = {
  async listForProduct(productId, status, page, limit) {
    const where = { productId };
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      prisma.productModule.findMany({
        where,
        orderBy: { displayOrder: "asc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.productModule.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdForProduct(id, productId) {
    return prisma.productModule.findFirst({ where: { id, productId } });
  },
  /** Standalone lookup for the flat /product-modules/:id routes, which take no separate productId to cross-check against — the id itself is authoritative for the record and its true parent product, so there is no manipulation surface here (unlike the nested /products/:id/modules routes, which use findByIdForProduct). */
  async findById(id) {
    return prisma.productModule.findUnique({ where: { id } });
  },
  async findByCodeForProduct(productId, code) {
    return prisma.productModule.findFirst({ where: { productId, code } });
  },
  async findBySlugForProduct(productId, slug) {
    return prisma.productModule.findFirst({ where: { productId, slug } });
  },
  async findUniqueSlugForProduct(productId, base) {
    const baseSlug = slugify4(base) || "module";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugForProduct(productId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  /** Unpaginated id list for one product — used only to validate a reorder request covers exactly this product's modules (§36), never returned to a client. */
  async listAllIdsForProduct(productId) {
    const rows = await prisma.productModule.findMany({ where: { productId }, select: { id: true } });
    return rows.map((r) => r.id);
  },
  async maxDisplayOrder(productId) {
    const top = await prisma.productModule.findFirst({ where: { productId }, orderBy: { displayOrder: "desc" } });
    return top?.displayOrder ?? -1;
  },
  async create(data) {
    return prisma.productModule.create({
      data: {
        productId: data.productId,
        code: data.code,
        name: data.name,
        slug: data.slug,
        description: data.description,
        status: data.status ?? "DRAFT",
        isCore: data.isCore ?? false,
        displayOrder: data.displayOrder
      }
    });
  },
  async update(id, data) {
    return prisma.productModule.update({ where: { id }, data });
  },
  /** All-or-nothing reorder — validated one product's worth of module ids, applied transactionally (§36). */
  async reorder(productId, orderedIds) {
    await prisma.$transaction(orderedIds.map((id, index) => prisma.productModule.update({ where: { id, productId }, data: { displayOrder: index } })));
  }
};

// server/services/productModuleService.ts
function isUniqueConstraintError2(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadProductOrThrow2(productId) {
  const product = await productRepository.findById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}
async function loadModuleOrThrow(id) {
  const module_ = await productModuleRepository.findById(id);
  if (!module_) throw new NotFoundError("Product module not found.");
  return module_;
}
var productModuleService = {
  async listModulesForProduct(productId, status, page, limit) {
    await loadProductOrThrow2(productId);
    return productModuleRepository.listForProduct(productId, status, page, limit);
  },
  async getModule(id) {
    return loadModuleOrThrow(id);
  },
  async createModule(caller, productId, input, meta = {}) {
    const product = await loadProductOrThrow2(productId);
    if (product.status === "ARCHIVED") {
      throw new ConflictError("Cannot add a module to an archived product.");
    }
    const existingCode = await productModuleRepository.findByCodeForProduct(productId, input.code);
    if (existingCode) throw new ConflictError(`A module with code "${input.code}" already exists on this product.`);
    let slug;
    if (input.slug) {
      const existingSlug = await productModuleRepository.findBySlugForProduct(productId, input.slug);
      if (existingSlug) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
      slug = input.slug;
    } else {
      slug = await productModuleRepository.findUniqueSlugForProduct(productId, input.name);
    }
    const displayOrder = input.displayOrder ?? await productModuleRepository.maxDisplayOrder(productId) + 1;
    let module_;
    try {
      module_ = await productModuleRepository.create({
        productId,
        code: input.code,
        name: input.name,
        slug,
        description: input.description,
        status: input.status,
        isCore: input.isCore,
        displayOrder
      });
    } catch (err) {
      throw isUniqueConstraintError2(err) ? new ConflictError("A module with this code or slug already exists on this product.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_CREATED",
      resourceType: "product_module",
      resourceId: module_.id,
      afterData: { productId, code: module_.code, name: module_.name, status: module_.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return module_;
  },
  async updateModule(caller, id, input, meta = {}) {
    const existing = await loadModuleOrThrow(id);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await productModuleRepository.findBySlugForProduct(existing.productId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
    }
    if (input.status === "INACTIVE" && existing.isCore) {
      throw new ValidationError("Use POST /product-modules/:id/archive to deactivate a core module.");
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.description !== void 0) patch.description = input.description;
    if (input.status !== void 0) patch.status = input.status;
    if (input.isCore !== void 0) patch.isCore = input.isCore;
    if (input.displayOrder !== void 0) patch.displayOrder = input.displayOrder;
    let updated;
    try {
      updated = await productModuleRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError2(err) ? new ConflictError("A module with this slug already exists on this product.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_UPDATED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async archiveModule(caller, id, meta = {}) {
    const existing = await loadModuleOrThrow(id);
    if (existing.status === "INACTIVE") {
      throw new ConflictError("This module is already inactive.");
    }
    const archived = await productModuleRepository.update(id, { status: "INACTIVE" });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_ARCHIVED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return archived;
  },
  /** Transactional, all-or-nothing reorder — validates every id belongs to this exact product before applying anything (§36). */
  async reorderModules(caller, productId, moduleIds, meta = {}) {
    await loadProductOrThrow2(productId);
    const existingIds = await productModuleRepository.listAllIdsForProduct(productId);
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(moduleIds);
    if (moduleIds.length !== existingIds.length || existingIds.some((id) => !requestedSet.has(id)) || moduleIds.some((id) => !existingSet.has(id))) {
      throw new ValidationError("The reorder request must include exactly this product's current modules, each exactly once.");
    }
    await productModuleRepository.reorder(productId, moduleIds);
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_REORDERED",
      resourceType: "product",
      resourceId: productId,
      afterData: { order: moduleIds },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/productSchemas.ts
import { z as z13 } from "zod";
var productTypeSchema = z13.enum(["PRODUCT", "SERVICE"]);
var productStatusSchema = z13.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
var SORT_FIELDS = ["name", "code", "type", "status", "displayOrder", "createdAt", "updatedAt"];
var listProductsQuerySchema = z13.object({
  page: z13.coerce.number().int().positive().default(1),
  limit: z13.coerce.number().int().positive().max(100).default(20),
  search: z13.string().trim().max(200).optional(),
  type: productTypeSchema.optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.coerce.boolean().optional(),
  sort: z13.enum(SORT_FIELDS).default("displayOrder"),
  order: z13.enum(["asc", "desc"]).default("asc")
});
var codeSchema = z13.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens").transform((v) => v.toUpperCase());
var createProductSchema = z13.object({
  code: codeSchema,
  name: z13.string().trim().min(1).max(200),
  slug: z13.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)").optional(),
  type: productTypeSchema,
  shortDescription: z13.string().trim().max(300).optional(),
  description: z13.string().trim().max(1e4).optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.boolean().optional(),
  displayOrder: z13.number().int().min(0).optional()
});
var updateProductSchema = z13.object({
  name: z13.string().trim().min(1).max(200).optional(),
  slug: z13.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)").optional(),
  type: productTypeSchema.optional(),
  shortDescription: z13.string().trim().max(300).nullable().optional(),
  description: z13.string().trim().max(1e4).nullable().optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.boolean().optional(),
  displayOrder: z13.number().int().min(0).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/productModuleSchemas.ts
import { z as z14 } from "zod";
var productModuleStatusSchema = z14.enum(["DRAFT", "ACTIVE", "INACTIVE"]);
var listProductModulesQuerySchema = z14.object({
  page: z14.coerce.number().int().positive().default(1),
  limit: z14.coerce.number().int().positive().max(100).default(50),
  status: productModuleStatusSchema.optional()
});
var codeSchema2 = z14.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens").transform((v) => v.toUpperCase());
var slugSchema = z14.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createProductModuleSchema = z14.object({
  code: codeSchema2,
  name: z14.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  description: z14.string().trim().max(1e4).optional(),
  status: productModuleStatusSchema.optional(),
  isCore: z14.boolean().optional(),
  displayOrder: z14.number().int().min(0).optional()
});
var updateProductModuleSchema = z14.object({
  name: z14.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  description: z14.string().trim().max(1e4).nullable().optional(),
  status: productModuleStatusSchema.optional(),
  isCore: z14.boolean().optional(),
  displayOrder: z14.number().int().min(0).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var reorderProductModulesSchema = z14.object({
  moduleIds: z14.array(z14.string().trim().uuid()).min(1).max(200)
});

// server/routes/v1/productRoutes.ts
var router16 = Router16();
router16.use(authenticateToken);
function requestMeta8(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router16.get(
  "/",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const query = listProductsQuerySchema.parse(req.query);
    const { rows, total } = await productService.listProducts(
      { search: query.search, type: query.type, status: query.status, isFeatured: query.isFeatured },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router16.get(
  "/:id",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(req.params.id);
    sendSuccess(res, { product });
  })
);
router16.post(
  "/",
  requirePermission("products.create"),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await productService.createProduct(req.user, input, requestMeta8(req));
    sendSuccess(res, { product }, 201);
  })
);
router16.patch(
  "/:id",
  requirePermission("products.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(req.user, req.params.id, input, requestMeta8(req));
    sendSuccess(res, { product });
  })
);
router16.post(
  "/:id/archive",
  requirePermission("products.archive"),
  asyncHandler(async (req, res) => {
    const product = await productService.archiveProduct(req.user, req.params.id, requestMeta8(req));
    sendSuccess(res, { product });
  })
);
router16.get(
  "/:id/modules",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const query = listProductModulesQuerySchema.parse(req.query);
    const { rows, total } = await productModuleService.listModulesForProduct(req.params.id, query.status, query.page, query.limit);
    sendSuccess(res, { modules: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router16.post(
  "/:id/modules",
  requirePermission("product_modules.create"),
  asyncHandler(async (req, res) => {
    const input = createProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.createModule(req.user, req.params.id, input, requestMeta8(req));
    sendSuccess(res, { module: module_ }, 201);
  })
);
router16.post(
  "/:id/modules/reorder",
  requirePermission("product_modules.reorder"),
  asyncHandler(async (req, res) => {
    const input = reorderProductModulesSchema.parse(req.body);
    await productModuleService.reorderModules(req.user, req.params.id, input.moduleIds, requestMeta8(req));
    sendSuccess(res, { message: "Modules reordered." });
  })
);
var productRoutes_default = router16;

// server/routes/v1/productModuleRoutes.ts
import { Router as Router17 } from "express";
var router17 = Router17();
router17.use(authenticateToken);
function requestMeta9(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router17.get(
  "/:id",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.getModule(req.params.id);
    sendSuccess(res, { module: module_ });
  })
);
router17.patch(
  "/:id",
  requirePermission("product_modules.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.updateModule(req.user, req.params.id, input, requestMeta9(req));
    sendSuccess(res, { module: module_ });
  })
);
router17.post(
  "/:id/archive",
  requirePermission("product_modules.archive"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.archiveModule(req.user, req.params.id, requestMeta9(req));
    sendSuccess(res, { module: module_ });
  })
);
var productModuleRoutes_default = router17;

// server/routes/v1/pageRoutes.ts
import { Router as Router18 } from "express";

// server/repositories/pageRepository.ts
function slugify5(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var withCurrentRevision = { include: { currentRevision: true } };
var withPublicRelations = { include: { currentRevision: true, featuredMedia: true } };
function buildWhere6(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}
var pageRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere6(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.page.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.page.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.page.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },
  /** Phase 11 public projection — PUBLISHED only, with the revision content and featured media needed to render the page (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId, slug) {
    return prisma.page.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify5(base) || "page";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async listRevisions(pageId) {
    return prisma.contentRevision.findMany({ where: { pageId }, orderBy: { version: "desc" } });
  },
  async softDelete(id) {
    await prisma.page.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/mediaService.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// server/repositories/mediaRepository.ts
function toApiMedia(row) {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}
function buildWhere7(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.mimeType) where.mimeType = filters.mimeType;
  if (filters.uploadedById) where.uploadedById = filters.uploadedById;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) {
    where.OR = [
      { originalFilename: { contains: filters.search, mode: "insensitive" } },
      { displayName: { contains: filters.search, mode: "insensitive" } }
    ];
  }
  return where;
}
var mediaRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere7(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.mediaAsset.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.mediaAsset.count({ where })
    ]);
    return { rows: rows.map(toApiMedia), total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped (§11). */
  async findByIdInOrg(id, organizationId) {
    return prisma.mediaAsset.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async create(data) {
    return prisma.mediaAsset.create({
      data: { ...data, sizeBytes: BigInt(data.sizeBytes), status: "PENDING" }
    });
  },
  async update(id, data) {
    return prisma.mediaAsset.update({ where: { id }, data });
  },
  /**
   * Race-safe conditional update — `WHERE id = ? AND status IN (...)`, the
   * same conditional-updateMany-plus-row-count pattern used for lead
   * conversion, workspace provisioning, and CMS optimistic concurrency
   * (Phases 5-8). Returns the affected row count so the caller can tell a
   * genuine race (0 rows — someone else already completed/archived it)
   * from success (1 row), never trusting a prior JS-level status check
   * alone against a concurrent request.
   */
  async updateWhereStatus(id, fromStatuses, data) {
    const result = await prisma.mediaAsset.updateMany({ where: { id, status: { in: fromStatuses } }, data });
    return result.count;
  },
  async markActive(id, data) {
    return this.updateWhereStatus(id, ["PENDING"], {
      status: "ACTIVE",
      sizeBytes: BigInt(data.sizeBytes),
      mimeType: data.mimeType,
      checksum: data.checksum,
      width: data.width,
      height: data.height
    });
  },
  async markFailed(id) {
    await prisma.mediaAsset.updateMany({ where: { id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "FAILED" } });
  },
  async softDelete(id) {
    await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  /** How many non-deleted Page/Post rows currently use this media as their featured image — used to block a hard delete of referenced media (§19). */
  async countContentReferences(id) {
    const [pages, posts] = await Promise.all([
      prisma.page.count({ where: { featuredMediaId: id, deletedAt: null } }),
      prisma.post.count({ where: { featuredMediaId: id, deletedAt: null } })
    ]);
    return pages + posts;
  }
};

// server/repositories/mediaUploadSessionRepository.ts
var mediaUploadSessionRepository = {
  async create(data) {
    return prisma.mediaUploadSession.create({ data });
  },
  async findByMediaId(mediaId) {
    return prisma.mediaUploadSession.findUnique({ where: { mediaId } });
  },
  /** Verifies possession of the upload secret via a DB equality lookup on its hash — never a fetch-then-compare in application code, matching workspaceInvitationRepository.findByToken's convention. */
  async findByMediaIdAndTokenHash(mediaId, tokenHash) {
    return prisma.mediaUploadSession.findFirst({ where: { mediaId, tokenHash } });
  },
  /** Race-safe conditional completion — `WHERE id = ? AND completed_at IS NULL`. Returns the affected row count so a concurrent double-completion is visible as 0, never silently re-applied. */
  async markCompleted(id) {
    const result = await prisma.mediaUploadSession.updateMany({ where: { id, completedAt: null }, data: { completedAt: /* @__PURE__ */ new Date() } });
    return result.count;
  }
};

// server/storage/localFilesystemProvider.ts
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
var HMAC_DOMAIN = "media-local-storage";
function rootDir() {
  return join(process.cwd(), config.localStorageDir);
}
function resolvePath(key) {
  const root = rootDir();
  const target = normalize(join(root, key));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Refusing to resolve storage key outside the local storage root: ${key}`);
  }
  return target;
}
function signLocalStorageToken(action, key, expiresAt) {
  return signHmac(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAt.getTime()}`);
}
function verifyLocalStorageToken(action, key, expiresAtMs, signature) {
  if (Date.now() > expiresAtMs) return false;
  return verifyHmacSignature(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAtMs}`, signature);
}
var LocalFilesystemStorageProvider = class {
  constructor() {
    this.name = "local";
  }
  async createSignedUploadUrl(params) {
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3);
    const sig = signLocalStorageToken("upload", params.key, expiresAt);
    const url = `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
    return { url, method: "PUT", headers: { "Content-Type": params.contentType }, expiresAt };
  }
  async createSignedReadUrl(params) {
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1e3);
    const sig = signLocalStorageToken("read", params.key, expiresAt);
    return `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
  }
  async headObject(key) {
    try {
      const s = await stat(resolvePath(key));
      if (!s.isFile()) return { exists: false };
      return { exists: true, sizeBytes: s.size };
    } catch {
      return { exists: false };
    }
  }
  async readHeadBytes(key, byteLength) {
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
  async deleteObject(key) {
    try {
      await rm(resolvePath(key), { force: true });
    } catch {
    }
  }
  async writeObject(key, bytes) {
    const path = resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async readObject(key) {
    return readFile(resolvePath(key));
  }
};
var localFilesystemStorageProvider = new LocalFilesystemStorageProvider();

// server/storage/s3CompatibleProvider.ts
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: config.objectStorageRegion || "auto",
      endpoint: config.objectStorageEndpoint || void 0,
      forcePathStyle: config.objectStorageForcePathStyle,
      credentials: { accessKeyId: config.objectStorageAccessKeyId, secretAccessKey: config.objectStorageSecretAccessKey }
    });
  }
  return client;
}
var S3CompatibleStorageProvider = class {
  constructor() {
    this.name = config.objectStorageProvider === "r2" ? "r2" : "s3";
  }
  async createSignedUploadUrl(params) {
    const command = new PutObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key, ContentType: params.contentType });
    const url = await getSignedUrl(getClient(), command, { expiresIn: config.mediaSignedUrlTtlSeconds });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    const command = new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key });
    return getSignedUrl(getClient(), command, { expiresIn: params.expiresInSeconds });
  }
  async headObject(key) {
    try {
      const res = await getClient().send(new HeadObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
      return { exists: true, sizeBytes: res.ContentLength, contentType: res.ContentType };
    } catch {
      return { exists: false };
    }
  }
  async readHeadBytes(key, byteLength) {
    try {
      const res = await getClient().send(
        new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: key, Range: `bytes=0-${byteLength - 1}` })
      );
      if (!res.Body) return Buffer.alloc(0);
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return Buffer.alloc(0);
    }
  }
  async deleteObject(key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
  }
};
var s3CompatibleStorageProvider = new S3CompatibleStorageProvider();

// server/storage/supabaseStorageProvider.ts
import { createClient } from "@supabase/supabase-js";
var client2 = null;
function getClient2() {
  if (!client2) {
    client2 = createClient(config.supabaseStorageUrl, config.supabaseStorageServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client2;
}
var SupabaseStorageProvider = class {
  constructor() {
    this.name = "supabase";
  }
  async createSignedUploadUrl(params) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).createSignedUploadUrl(params.key);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed upload URL (${error?.message ?? "unknown error"})`);
    return {
      url: `${config.supabaseStorageUrl}/storage/v1${data.signedUrl.startsWith("/") ? "" : "/"}${data.signedUrl}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).createSignedUrl(params.key, params.expiresInSeconds);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed read URL (${error?.message ?? "unknown error"})`);
    return data.signedUrl;
  }
  async headObject(key) {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).list(dir, { search: name, limit: 1 });
    if (error || !data || data.length === 0) return { exists: false };
    const found = data.find((f) => f.name === name);
    if (!found) return { exists: false };
    return { exists: true, sizeBytes: found.metadata?.size, contentType: found.metadata?.mimetype };
  }
  async readHeadBytes(key, byteLength) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).download(key, { transform: void 0 });
    if (error || !data) return Buffer.alloc(0);
    const arrayBuffer = await data.slice(0, byteLength).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  async deleteObject(key) {
    const { error } = await getClient2().storage.from(config.objectStorageBucket).remove([key]);
    if (error && !/not.*found/i.test(error.message)) throw new Error(`Supabase Storage: delete failed (${error.message})`);
  }
};
var supabaseStorageProvider = new SupabaseStorageProvider();

// server/storage/testStorageProvider.ts
var TestStorageProvider = class {
  constructor() {
    this.name = "test";
    this.objects = /* @__PURE__ */ new Map();
    /** Test-only hook: keys in this set report `headObject`/`readHeadBytes` as if the object never arrived — simulates an abandoned/failed upload (§20 orphan handling). */
    this.missingKeys = /* @__PURE__ */ new Set();
  }
  /** Test helper — simulates the browser's PUT to the signed URL succeeding, without a real HTTP round-trip. */
  seedObject(key, bytes, contentType) {
    this.objects.set(key, { bytes, contentType });
  }
  reset() {
    this.objects.clear();
    this.missingKeys.clear();
  }
  async createSignedUploadUrl(params) {
    return {
      url: `https://test-storage.invalid/upload/${encodeURIComponent(params.key)}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    return `https://test-storage.invalid/read/${encodeURIComponent(params.key)}?exp=${Date.now() + params.expiresInSeconds * 1e3}`;
  }
  async headObject(key) {
    if (this.missingKeys.has(key)) return { exists: false };
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return { exists: true, sizeBytes: obj.bytes.length, contentType: obj.contentType };
  }
  async readHeadBytes(key, byteLength) {
    if (this.missingKeys.has(key)) return Buffer.alloc(0);
    const obj = this.objects.get(key);
    if (!obj) return Buffer.alloc(0);
    return obj.bytes.subarray(0, byteLength);
  }
  async deleteObject(key) {
    this.objects.delete(key);
  }
};
var testStorageProvider = new TestStorageProvider();

// server/storage/index.ts
function getStorageProvider() {
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

// server/utils/storageKey.ts
function sanitizeFilename(original) {
  const base = original.split(/[/\\]/).pop() ?? "file";
  let safe = base.normalize("NFKD").replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-{2,}/g, "-").replace(/^[.\-]+/, "").slice(0, 150);
  if (!safe || safe === "." || safe === "..") safe = "file";
  return safe;
}
function buildStorageKey(organizationId, mediaId, originalFilename) {
  return `organizations/${organizationId}/media/${mediaId}/${sanitizeFilename(originalFilename)}`;
}

// server/utils/fileSignature.ts
var ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
var ALLOWED_DOCUMENT_MIME_TYPES = ["application/pdf"];
var ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_DOCUMENT_MIME_TYPES];
function isImageMimeType(mimeType) {
  return ALLOWED_IMAGE_MIME_TYPES.includes(mimeType);
}
function mediaCategoryFor(mimeType) {
  return isImageMimeType(mimeType) ? "image" : "document";
}
var EXTENSION_BY_MIME = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"]
};
function extensionMatchesMimeType(filename, mimeType) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return EXTENSION_BY_MIME[mimeType].includes(ext);
}
function verifyFileSignature(mimeType, head) {
  if (mimeType === "image/svg+xml") {
    const text = head.toString("utf8", 0, Math.min(head.length, 512)).trimStart().toLowerCase();
    return text.startsWith("<?xml") || text.startsWith("<svg");
  }
  if (mimeType === "image/webp") return isValidWebp(head);
  const sig = SIGNATURES[mimeType];
  if (!sig) return false;
  return sig.some((candidate) => head.length >= candidate.length && candidate.every((byte, i) => head[i] === byte));
}
var SIGNATURES = {
  "image/jpeg": [[255, 216, 255]],
  "image/png": [[137, 80, 78, 71, 13, 10, 26, 10]],
  "image/gif": [
    [71, 73, 70, 56, 55, 97],
    [71, 73, 70, 56, 57, 97]
  ],
  "application/pdf": [[37, 80, 68, 70]]
};
function isValidWebp(head) {
  if (head.length < 12) return false;
  return head[0] === 82 && head[1] === 73 && head[2] === 70 && head[3] === 70 && head.subarray(8, 12).toString("ascii") === "WEBP";
}

// server/services/mediaService.ts
function maxSizeFor(mimeType) {
  return isImageMimeType(mimeType) ? config.mediaMaxImageSizeBytes : config.mediaMaxDocumentSizeBytes;
}
async function loadMediaOrThrow(id, organizationId) {
  const media = await mediaRepository.findByIdInOrg(id, organizationId);
  if (!media) throw new NotFoundError("Media not found.");
  return media;
}
async function assertFeaturedMediaUsable(mediaId, organizationId) {
  const media = await mediaRepository.findByIdInOrg(mediaId, organizationId);
  if (!media) throw new ValidationError("featuredMediaId does not refer to a media asset in this organization.");
  if (media.status !== "ACTIVE") throw new ValidationError("featuredMediaId must refer to an ACTIVE media asset.");
  if (!isImageMimeType(media.mimeType)) throw new ValidationError("featuredMediaId must refer to an image.");
}
var mediaService = {
  async listMedia(organizationId, filters, page, limit, sort, order) {
    return mediaRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getMedia(organizationId, id) {
    return toApiMedia(await loadMediaOrThrow(id, organizationId));
  },
  async createUploadSession(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (!extensionMatchesMimeType(input.filename, input.mimeType)) {
      throw new ValidationError(`The file extension does not match the declared type (${input.mimeType}).`);
    }
    const maxSize = maxSizeFor(input.mimeType);
    if (input.sizeBytes > maxSize) {
      throw new ValidationError(`File exceeds the maximum allowed size for ${mediaCategoryFor(input.mimeType)}s (${maxSize} bytes).`);
    }
    const mediaId = randomUUID2();
    const storageKey = buildStorageKey(organizationId, mediaId, input.filename);
    const provider = getStorageProvider();
    const media = await mediaRepository.create({
      id: mediaId,
      organizationId,
      originalFilename: input.filename,
      displayName: input.displayName,
      storageProvider: provider.name,
      storageBucket: config.objectStorageBucket || provider.name,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      altText: input.altText,
      caption: input.caption,
      uploadedById: caller.id
    });
    const upload = await provider.createSignedUploadUrl({ key: storageKey, contentType: input.mimeType, maxSizeBytes: maxSize });
    const rawToken = generateUploadToken();
    await mediaUploadSessionRepository.create({
      mediaId,
      organizationId,
      uploadedById: caller.id,
      storageKey,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + config.mediaUploadSessionTtlMinutes * 60 * 1e3)
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_INITIATED",
      resourceType: "media",
      resourceId: mediaId,
      afterData: { originalFilename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { media: toApiMedia(media), upload, uploadToken: rawToken };
  },
  async completeUpload(caller, id, token, meta = {}) {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);
    if (media.status !== "PENDING") {
      throw new ConflictError(`This upload cannot be completed \u2014 media status is ${media.status}, not PENDING.`);
    }
    const session = await mediaUploadSessionRepository.findByMediaIdAndTokenHash(id, hashToken(token));
    if (!session) throw new ValidationError("Invalid upload token for this media.");
    if (session.completedAt) throw new ConflictError("This upload session has already been completed.");
    if (session.expiresAt.getTime() < Date.now()) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("This upload session has expired. Start a new upload.");
    }
    const provider = getStorageProvider();
    const head = await provider.headObject(media.storageKey);
    if (!head.exists) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("No object was found at the expected storage location \u2014 the upload did not complete.");
    }
    const headBytes = await provider.readHeadBytes(media.storageKey, 32);
    if (headBytes.length > 0 && !verifyFileSignature(media.mimeType, headBytes)) {
      await mediaRepository.markFailed(id);
      throw new ValidationError("The uploaded file's content does not match its declared type.");
    }
    const maxSize = maxSizeFor(media.mimeType);
    const verifiedSize = head.sizeBytes ?? Number(media.sizeBytes);
    if (verifiedSize > maxSize) {
      await mediaRepository.markFailed(id);
      throw new ValidationError(`The uploaded file exceeds the maximum allowed size (${maxSize} bytes).`);
    }
    const claimed = await mediaUploadSessionRepository.markCompleted(session.id);
    if (claimed === 0) throw new ConflictError("This upload session has already been completed.");
    const activatedCount = await mediaRepository.markActive(id, { sizeBytes: verifiedSize, mimeType: head.contentType ?? media.mimeType });
    if (activatedCount === 0) throw new ConflictError(`This upload cannot be completed \u2014 media status is no longer PENDING.`);
    const activated = await loadMediaOrThrow(id, organizationId);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_COMPLETED",
      resourceType: "media",
      resourceId: id,
      afterData: { sizeBytes: verifiedSize },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(activated);
  },
  async getReadUrl(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);
    if (media.status !== "ACTIVE" && media.status !== "ARCHIVED") {
      throw new ConflictError("This media has no readable object yet.");
    }
    const provider = getStorageProvider();
    const url = await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaSignedUrlTtlSeconds });
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_SIGNED_URL_ISSUED",
      resourceType: "media",
      resourceId: id,
      afterData: { expiresAt: expiresAt.toISOString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { url, expiresAt: expiresAt.toISOString() };
  },
  async updateMedia(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    const patch = {};
    if (input.displayName !== void 0) patch.displayName = input.displayName;
    if (input.altText !== void 0) patch.altText = input.altText;
    if (input.caption !== void 0) patch.caption = input.caption;
    if (input.visibility !== void 0) patch.visibility = input.visibility;
    const updated = await mediaRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_METADATA_UPDATED",
      resourceType: "media",
      resourceId: id,
      beforeData: { displayName: existing.displayName, altText: existing.altText, caption: existing.caption, visibility: existing.visibility },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(updated);
  },
  async archiveMedia(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This media is already archived.");
    const archivedCount = await mediaRepository.updateWhereStatus(id, ["PENDING", "ACTIVE", "FAILED"], { status: "ARCHIVED" });
    if (archivedCount === 0) throw new ConflictError("This media is already archived.");
    const updated = await loadMediaOrThrow(id, organizationId);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_ARCHIVED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(updated);
  },
  async deleteMedia(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    const referenceCount = await mediaRepository.countContentReferences(id);
    if (referenceCount > 0) {
      throw new ConflictError(
        `This media is currently used as a featured image by ${referenceCount} page/post \u2014 detach it from that content before deleting.`
      );
    }
    await mediaRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_DELETED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status, originalFilename: existing.originalFilename },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/services/pageService.ts
var CONTENT_EDIT_BLOCKED_STATUSES = /* @__PURE__ */ new Set(["PUBLISHED", "ARCHIVED"]);
function isUniqueConstraintError3(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
function assertHasPublishableContent(revision) {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This page needs a title and body before it can be published or scheduled.");
  }
}
async function loadPageOrThrow(id, organizationId) {
  const page = await pageRepository.findByIdInOrg(id, organizationId);
  if (!page) throw new NotFoundError("Page not found.");
  return page;
}
var pageService = {
  async listPages(organizationId, filters, page, limit, sort, order) {
    return pageRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPage(organizationId, id) {
    return loadPageOrThrow(id, organizationId);
  },
  async listRevisions(organizationId, id) {
    await loadPageOrThrow(id, organizationId);
    return pageRepository.listRevisions(id);
  },
  async createPage(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    const slug = input.slug ?? await pageRepository.findUniqueSlugInOrg(organizationId, input.title);
    let createdId;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: { organizationId, slug, title: input.title, status: "DRAFT", createdById: caller.id, featuredMediaId: input.featuredMediaId }
        });
        const revision = await tx.contentRevision.create({
          data: {
            pageId: page.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {},
            createdById: caller.id
          }
        });
        await tx.page.update({ where: { id: page.id }, data: { currentRevisionId: revision.id } });
        return page.id;
      });
    } catch (err) {
      throw isUniqueConstraintError3(err) ? new ConflictError("A page with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_CREATED",
      resourceType: "page",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(createdId, organizationId);
  },
  async updatePage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    const effectiveStatus = input.status ?? existing.status;
    const hasContentEdit = input.title !== void 0 || input.body !== void 0 || input.metadata !== void 0 || input.slug !== void 0;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES.has(effectiveStatus)) {
      throw new ConflictError(`Page content cannot be edited while status is ${effectiveStatus}.`);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    const hasFeaturedMediaEdit = input.featuredMediaId !== void 0;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Page content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }
    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;
    try {
      await prisma.$transaction(async (tx) => {
        const pagePatch = {};
        if (input.status !== void 0) pagePatch.status = input.status;
        if (input.slug !== void 0) pagePatch.slug = input.slug;
        if (input.title !== void 0) pagePatch.title = input.title;
        if (hasFeaturedMediaEdit) pagePatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) pagePatch.publishedAt = null;
        if (currentRevision && (unpublishing || hasContentEdit && currentRevision.status === "PUBLISHED")) {
          const newRevision = await tx.contentRevision.create({
            data: {
              pageId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: input.metadata ?? currentRevision.metadata,
              createdById: caller.id
            }
          });
          pagePatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch = {};
          if (input.title !== void 0) revisionPatch.title = input.title;
          if (input.body !== void 0) revisionPatch.body = input.body;
          if (input.metadata !== void 0) revisionPatch.metadata = input.metadata;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }
        if (hasContentEdit && Object.keys(pagePatch).length === 0) {
          pagePatch.updatedAt = /* @__PURE__ */ new Date();
        }
        if (Object.keys(pagePatch).length > 0) {
          const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
          const result = await tx.page.updateMany({ where, data: pagePatch });
          if (result.count === 0) {
            throw new ConflictError("This page was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError3(err) ? new ConflictError("A page with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_UPDATED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "page",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return loadPageOrThrow(id, organizationId);
  },
  async submitForReview(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT page can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This page needs body content before it can be submitted for review.");
    }
    await prisma.page.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SUBMITTED_FOR_REVIEW",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async publishPage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This page has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);
    const now = /* @__PURE__ */ new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.page.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } })
    ]);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_PUBLISHED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async schedulePage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    assertHasPublishableContent(existing.currentRevision);
    await prisma.page.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SCHEDULED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async archivePage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This page is already archived.");
    await prisma.page.update({ where: { id }, data: { status: "ARCHIVED" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_ARCHIVED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async revertPage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before its content can be reverted.");
    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, pageId: id } });
    if (!target) throw new NotFoundError("Revision not found on this page.");
    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";
    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          pageId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata,
          createdById: caller.id
        }
      });
      await tx.page.update({
        where: { id },
        data: {
          currentRevisionId: newRevision.id,
          ...wasPublished ? { status: "DRAFT", publishedAt: null } : {}
        }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_REVERTED",
      resourceType: "page",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async deletePage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    await pageRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_DELETED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/pageSchemas.ts
import { z as z16 } from "zod";

// server/schemas/contentSchemas.ts
import { z as z15 } from "zod";
var contentStatusSchema = z15.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);
var patchableContentStatusSchema = z15.enum(["DRAFT"]);
var expectedUpdatedAtSchema = z15.coerce.date().optional();
var revertContentSchema = z15.object({
  revisionId: z15.string().trim().uuid()
});
var SORT_FIELDS2 = ["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"];
var listContentQuerySchema = z15.object({
  page: z15.coerce.number().int().positive().default(1),
  limit: z15.coerce.number().int().positive().max(100).default(20),
  search: z15.string().trim().max(200).optional(),
  status: contentStatusSchema.optional(),
  sort: z15.enum(SORT_FIELDS2).default("updatedAt"),
  order: z15.enum(["asc", "desc"]).default("desc")
});
var scheduleContentSchema = z15.object({
  scheduledAt: z15.coerce.date().refine((d) => d.getTime() > Date.now(), { message: "scheduledAt must be in the future" })
});
var slugSchema2 = z15.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createCategorySchema = z15.object({
  name: z15.string().trim().min(1).max(150),
  slug: slugSchema2.optional(),
  description: z15.string().trim().max(2e3).optional()
});
var updateCategorySchema = z15.object({
  name: z15.string().trim().min(1).max(150).optional(),
  slug: slugSchema2.optional(),
  description: z15.string().trim().max(2e3).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var createTagSchema = z15.object({
  name: z15.string().trim().min(1).max(100),
  slug: slugSchema2.optional()
});
var updateTagSchema = z15.object({
  name: z15.string().trim().min(1).max(100).optional(),
  slug: slugSchema2.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/pageSchemas.ts
var slugSchema3 = z16.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createPageSchema = z16.object({
  title: z16.string().trim().min(1).max(200),
  slug: slugSchema3.optional(),
  body: z16.string().trim().max(5e5).default(""),
  metadata: z16.record(z16.unknown()).optional(),
  featuredMediaId: z16.string().trim().uuid().optional()
});
var updatePageSchema = z16.object({
  title: z16.string().trim().min(1).max(200).optional(),
  slug: slugSchema3.optional(),
  body: z16.string().trim().max(5e5).optional(),
  metadata: z16.record(z16.unknown()).optional(),
  status: patchableContentStatusSchema.optional(),
  featuredMediaId: z16.string().trim().uuid().nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema
}).refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });

// server/routes/v1/pageRoutes.ts
var router18 = Router18();
router18.use(authenticateToken);
function requestMeta10(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router18.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listContentQuerySchema.parse(req.query);
    const { rows, total } = await pageService.listPages(
      req.user.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { pages: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router18.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const page = await pageService.getPage(req.user.organizationId, req.params.id);
    sendSuccess(res, { page });
  })
);
router18.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await pageService.listRevisions(req.user.organizationId, req.params.id);
    sendSuccess(res, { revisions });
  })
);
router18.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPageSchema.parse(req.body);
    const page = await pageService.createPage(req.user, input, requestMeta10(req));
    sendSuccess(res, { page }, 201);
  })
);
router18.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePageSchema.parse(req.body);
    const page = await pageService.updatePage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const page = await pageService.submitForReview(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const page = await pageService.publishPage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const page = await pageService.schedulePage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const page = await pageService.archivePage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const page = await pageService.revertPage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await pageService.deletePage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { message: "Page deleted." });
  })
);
var pageRoutes_default = router18;

// server/routes/v1/postRoutes.ts
import { Router as Router19 } from "express";

// server/repositories/postRepository.ts
function slugify6(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var withRelations = { include: { currentRevision: true, category: true, author: true, tags: { include: { tag: true } } } };
var withPublicRelations2 = {
  include: {
    currentRevision: true,
    category: true,
    author: { include: { user: { select: { firstName: true, lastName: true } } } },
    tags: { include: { tag: true } },
    featuredMedia: true
  }
};
function buildWhere8(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.tagId) where.tags = { some: { tagId: filters.tagId } };
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}
var postRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere8(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.post.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.post.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.post.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },
  /** Phase 11 public projection — PUBLISHED only, with category/author/tags/featured media/revision content (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId, slug) {
    return prisma.post.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations2 });
  },
  /** Phase 11 public projection — PUBLISHED only, paginated, with the same relations as findPublishedBySlugWithMedia. */
  async listPublished(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere8(organizationId, { ...filters, status: "PUBLISHED" });
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withPublicRelations2 }),
      prisma.post.count({ where })
    ]);
    return { rows, total };
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify6(base) || "post";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async listRevisions(postId) {
    return prisma.contentRevision.findMany({ where: { postId }, orderBy: { version: "desc" } });
  },
  async setTags(postId, tagIds) {
    await prisma.$transaction([
      prisma.postTag.deleteMany({ where: { postId } }),
      ...tagIds.length > 0 ? [prisma.postTag.createMany({ data: tagIds.map((tagId) => ({ postId, tagId })) })] : []
    ]);
  },
  async softDelete(id) {
    await prisma.post.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/repositories/categoryRepository.ts
function slugify7(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var categoryRepository = {
  async list(organizationId) {
    return prisma.category.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.category.findFirst({ where: { id, organizationId } });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.category.findFirst({ where: { organizationId, slug } });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify7(base) || "category";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async create(data) {
    return prisma.category.create({ data });
  },
  async update(id, data) {
    return prisma.category.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.category.delete({ where: { id } });
  }
};

// server/repositories/tagRepository.ts
function slugify8(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var tagRepository = {
  async list(organizationId) {
    return prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.tag.findFirst({ where: { id, organizationId } });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.tag.findFirst({ where: { organizationId, slug } });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify8(base) || "tag";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async findByIdsInOrg(ids, organizationId) {
    if (ids.length === 0) return [];
    return prisma.tag.findMany({ where: { id: { in: ids }, organizationId } });
  },
  async create(data) {
    return prisma.tag.create({ data });
  },
  async update(id, data) {
    return prisma.tag.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.tag.delete({ where: { id } });
  }
};

// server/services/postService.ts
var CONTENT_EDIT_BLOCKED_STATUSES2 = /* @__PURE__ */ new Set(["PUBLISHED", "ARCHIVED"]);
function isUniqueConstraintError4(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
function assertHasPublishableContent2(revision) {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This post needs a title and body before it can be published or scheduled.");
  }
}
async function loadPostOrThrow(id, organizationId) {
  const post = await postRepository.findByIdInOrg(id, organizationId);
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}
async function assertCategoryInOrg(categoryId, organizationId) {
  if (!categoryId) return;
  const category = await categoryRepository.findByIdInOrg(categoryId, organizationId);
  if (!category) throw new ValidationError("categoryId does not refer to a category in this organization.");
}
async function assertTagsInOrg(tagIds, organizationId) {
  if (!tagIds || tagIds.length === 0) return;
  const found = await tagRepository.findByIdsInOrg(tagIds, organizationId);
  if (found.length !== new Set(tagIds).size) {
    throw new ValidationError("One or more tagIds do not refer to a tag in this organization.");
  }
}
var postService = {
  async listPosts(organizationId, filters, page, limit, sort, order) {
    return postRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPost(organizationId, id) {
    return loadPostOrThrow(id, organizationId);
  },
  async listRevisions(organizationId, id) {
    await loadPostOrThrow(id, organizationId);
    return postRepository.listRevisions(id);
  },
  async createPost(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    await assertCategoryInOrg(input.categoryId, organizationId);
    await assertTagsInOrg(input.tagIds, organizationId);
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    if (input.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    const slug = input.slug ?? await postRepository.findUniqueSlugInOrg(organizationId, input.title);
    let createdId;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            categoryId: input.categoryId,
            authorId: input.authorId,
            featuredMediaId: input.featuredMediaId,
            createdById: caller.id
          }
        });
        const revision = await tx.contentRevision.create({
          data: {
            postId: post.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {},
            createdById: caller.id
          }
        });
        await tx.post.update({ where: { id: post.id }, data: { currentRevisionId: revision.id } });
        if (input.tagIds && input.tagIds.length > 0) {
          await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: post.id, tagId })) });
        }
        return post.id;
      });
    } catch (err) {
      throw isUniqueConstraintError4(err) ? new ConflictError("A post with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_CREATED",
      resourceType: "post",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(createdId, organizationId);
  },
  async updatePost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    const effectiveStatus = input.status ?? existing.status;
    const hasContentEdit = input.title !== void 0 || input.body !== void 0 || input.metadata !== void 0 || input.slug !== void 0;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES2.has(effectiveStatus)) {
      throw new ConflictError(`Post content cannot be edited while status is ${effectiveStatus}.`);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    if (input.categoryId !== void 0) await assertCategoryInOrg(input.categoryId, organizationId);
    if (input.tagIds !== void 0) await assertTagsInOrg(input.tagIds, organizationId);
    const hasFeaturedMediaEdit = input.featuredMediaId !== void 0;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Post content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }
    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;
    try {
      await prisma.$transaction(async (tx) => {
        const postPatch = {};
        if (input.status !== void 0) postPatch.status = input.status;
        if (input.slug !== void 0) postPatch.slug = input.slug;
        if (input.title !== void 0) postPatch.title = input.title;
        if (input.categoryId !== void 0) postPatch.categoryId = input.categoryId;
        if (input.authorId !== void 0) postPatch.authorId = input.authorId;
        if (hasFeaturedMediaEdit) postPatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) postPatch.publishedAt = null;
        if (currentRevision && (unpublishing || hasContentEdit && currentRevision.status === "PUBLISHED")) {
          const newRevision = await tx.contentRevision.create({
            data: {
              postId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: input.metadata ?? currentRevision.metadata,
              createdById: caller.id
            }
          });
          postPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch = {};
          if (input.title !== void 0) revisionPatch.title = input.title;
          if (input.body !== void 0) revisionPatch.body = input.body;
          if (input.metadata !== void 0) revisionPatch.metadata = input.metadata;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }
        const willTouchTags = input.tagIds !== void 0;
        if (hasContentEdit && Object.keys(postPatch).length === 0 && !willTouchTags) {
          postPatch.updatedAt = /* @__PURE__ */ new Date();
        }
        if (Object.keys(postPatch).length > 0) {
          const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
          const result = await tx.post.updateMany({ where, data: postPatch });
          if (result.count === 0) {
            throw new ConflictError("This post was changed by someone else since you loaded it. Reload and try again.");
          }
        }
        if (input.tagIds !== void 0) {
          await tx.postTag.deleteMany({ where: { postId: id } });
          if (input.tagIds.length > 0) {
            await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: id, tagId })) });
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError4(err) ? new ConflictError("A post with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_UPDATED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "post",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return loadPostOrThrow(id, organizationId);
  },
  async submitForReview(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT post can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This post needs body content before it can be submitted for review.");
    }
    await prisma.post.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SUBMITTED_FOR_REVIEW",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async publishPost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This post has no content revision to publish.");
    assertHasPublishableContent2(existing.currentRevision);
    const now = /* @__PURE__ */ new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.post.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } })
    ]);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_PUBLISHED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async schedulePost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    assertHasPublishableContent2(existing.currentRevision);
    await prisma.post.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SCHEDULED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async archivePost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This post is already archived.");
    await prisma.post.update({ where: { id }, data: { status: "ARCHIVED" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_ARCHIVED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async revertPost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before its content can be reverted.");
    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, postId: id } });
    if (!target) throw new NotFoundError("Revision not found on this post.");
    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";
    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          postId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata,
          createdById: caller.id
        }
      });
      await tx.post.update({
        where: { id },
        data: {
          currentRevisionId: newRevision.id,
          ...wasPublished ? { status: "DRAFT", publishedAt: null } : {}
        }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_REVERTED",
      resourceType: "post",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async deletePost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    await postRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_DELETED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/postSchemas.ts
import { z as z17 } from "zod";
var slugSchema4 = z17.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createPostSchema = z17.object({
  title: z17.string().trim().min(1).max(200),
  slug: slugSchema4.optional(),
  body: z17.string().trim().max(5e5).default(""),
  metadata: z17.record(z17.unknown()).optional(),
  categoryId: z17.string().trim().uuid().optional(),
  authorId: z17.string().trim().uuid().optional(),
  tagIds: z17.array(z17.string().trim().uuid()).max(50).optional(),
  featuredMediaId: z17.string().trim().uuid().optional()
});
var updatePostSchema = z17.object({
  title: z17.string().trim().min(1).max(200).optional(),
  slug: slugSchema4.optional(),
  body: z17.string().trim().max(5e5).optional(),
  metadata: z17.record(z17.unknown()).optional(),
  status: patchableContentStatusSchema.optional(),
  categoryId: z17.string().trim().uuid().nullable().optional(),
  authorId: z17.string().trim().uuid().nullable().optional(),
  tagIds: z17.array(z17.string().trim().uuid()).max(50).optional(),
  featuredMediaId: z17.string().trim().uuid().nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema
}).refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
var listPostsQuerySchema = z17.object({
  page: z17.coerce.number().int().positive().default(1),
  limit: z17.coerce.number().int().positive().max(100).default(20),
  search: z17.string().trim().max(200).optional(),
  status: z17.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  categoryId: z17.string().trim().uuid().optional(),
  tagId: z17.string().trim().uuid().optional(),
  sort: z17.enum(["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"]).default("updatedAt"),
  order: z17.enum(["asc", "desc"]).default("desc")
});

// server/routes/v1/postRoutes.ts
var router19 = Router19();
router19.use(authenticateToken);
function requestMeta11(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router19.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listPostsQuerySchema.parse(req.query);
    const { rows, total } = await postService.listPosts(
      req.user.organizationId,
      { search: query.search, status: query.status, categoryId: query.categoryId, tagId: query.tagId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router19.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const post = await postService.getPost(req.user.organizationId, req.params.id);
    sendSuccess(res, { post });
  })
);
router19.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await postService.listRevisions(req.user.organizationId, req.params.id);
    sendSuccess(res, { revisions });
  })
);
router19.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPostSchema.parse(req.body);
    const post = await postService.createPost(req.user, input, requestMeta11(req));
    sendSuccess(res, { post }, 201);
  })
);
router19.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePostSchema.parse(req.body);
    const post = await postService.updatePost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const post = await postService.submitForReview(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const post = await postService.publishPost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const post = await postService.schedulePost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const post = await postService.archivePost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const post = await postService.revertPost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await postService.deletePost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { message: "Post deleted." });
  })
);
var postRoutes_default = router19;

// server/routes/v1/categoryRoutes.ts
import { Router as Router20 } from "express";

// server/services/categoryService.ts
function isUniqueConstraintError5(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadCategoryOrThrow(id, organizationId) {
  const category = await categoryRepository.findByIdInOrg(id, organizationId);
  if (!category) throw new NotFoundError("Category not found.");
  return category;
}
var categoryService = {
  async listCategories(organizationId) {
    return categoryRepository.list(organizationId);
  },
  async getCategory(organizationId, id) {
    return loadCategoryOrThrow(id, organizationId);
  },
  async createCategory(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    const slug = input.slug ?? await categoryRepository.findUniqueSlugInOrg(organizationId, input.name);
    let category;
    try {
      category = await categoryRepository.create({ organizationId, name: input.name, slug, description: input.description });
    } catch (err) {
      throw isUniqueConstraintError5(err) ? new ConflictError("A category with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_CREATED",
      resourceType: "category",
      resourceId: category.id,
      afterData: { name: category.name, slug: category.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return category;
  },
  async updateCategory(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.description !== void 0) patch.description = input.description;
    let updated;
    try {
      updated = await categoryRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError5(err) ? new ConflictError("A category with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_UPDATED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteCategory(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);
    await categoryRepository.delete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_DELETED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/categoryRoutes.ts
var router20 = Router20();
router20.use(authenticateToken);
function requestMeta12(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router20.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const categories = await categoryService.listCategories(req.user.organizationId);
    sendSuccess(res, { categories });
  })
);
router20.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const category = await categoryService.getCategory(req.user.organizationId, req.params.id);
    sendSuccess(res, { category });
  })
);
router20.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(req.user, input, requestMeta12(req));
    sendSuccess(res, { category }, 201);
  })
);
router20.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(req.user, req.params.id, input, requestMeta12(req));
    sendSuccess(res, { category });
  })
);
router20.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await categoryService.deleteCategory(req.user, req.params.id, requestMeta12(req));
    sendSuccess(res, { message: "Category deleted." });
  })
);
var categoryRoutes_default = router20;

// server/routes/v1/tagRoutes.ts
import { Router as Router21 } from "express";

// server/services/tagService.ts
function isUniqueConstraintError6(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadTagOrThrow(id, organizationId) {
  const tag = await tagRepository.findByIdInOrg(id, organizationId);
  if (!tag) throw new NotFoundError("Tag not found.");
  return tag;
}
var tagService = {
  async listTags(organizationId) {
    return tagRepository.list(organizationId);
  },
  async getTag(organizationId, id) {
    return loadTagOrThrow(id, organizationId);
  },
  async createTag(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }
    const slug = input.slug ?? await tagRepository.findUniqueSlugInOrg(organizationId, input.name);
    let tag;
    try {
      tag = await tagRepository.create({ organizationId, name: input.name, slug });
    } catch (err) {
      throw isUniqueConstraintError6(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_CREATED",
      resourceType: "tag",
      resourceId: tag.id,
      afterData: { name: tag.name, slug: tag.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return tag;
  },
  async updateTag(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    let updated;
    try {
      updated = await tagRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError6(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_UPDATED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteTag(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);
    await tagRepository.delete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_DELETED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/tagRoutes.ts
var router21 = Router21();
router21.use(authenticateToken);
function requestMeta13(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router21.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tags = await tagService.listTags(req.user.organizationId);
    sendSuccess(res, { tags });
  })
);
router21.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tag = await tagService.getTag(req.user.organizationId, req.params.id);
    sendSuccess(res, { tag });
  })
);
router21.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createTagSchema.parse(req.body);
    const tag = await tagService.createTag(req.user, input, requestMeta13(req));
    sendSuccess(res, { tag }, 201);
  })
);
router21.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateTagSchema.parse(req.body);
    const tag = await tagService.updateTag(req.user, req.params.id, input, requestMeta13(req));
    sendSuccess(res, { tag });
  })
);
router21.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await tagService.deleteTag(req.user, req.params.id, requestMeta13(req));
    sendSuccess(res, { message: "Tag deleted." });
  })
);
var tagRoutes_default = router21;

// server/routes/v1/authorRoutes.ts
import { Router as Router22 } from "express";

// server/repositories/authorRepository.ts
var withUser = { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, status: true } } } };
var authorRepository = {
  async list() {
    return prisma.author.findMany({ ...withUser, orderBy: { createdAt: "desc" } });
  },
  async findById(id) {
    return prisma.author.findUnique({ where: { id }, ...withUser });
  },
  async findByUserId(userId) {
    return prisma.author.findUnique({ where: { userId } });
  },
  async create(data) {
    return prisma.author.create({ data, ...withUser });
  },
  async update(id, data) {
    return prisma.author.update({ where: { id }, data, ...withUser });
  }
};

// server/services/authorService.ts
async function loadAuthorOrThrow(id) {
  const author = await authorRepository.findById(id);
  if (!author) throw new NotFoundError("Author not found.");
  return author;
}
var authorService = {
  async listAuthors() {
    return authorRepository.list();
  },
  async getAuthor(id) {
    return loadAuthorOrThrow(id);
  },
  async createAuthor(caller, input, meta = {}) {
    const user = await userRepository.findById(input.userId);
    if (!user) throw new ValidationError("userId does not refer to an existing user.");
    const existing = await authorRepository.findByUserId(input.userId);
    if (existing) throw new ConflictError("This user already has an author profile.", { existingAuthorId: existing.id });
    const author = await authorRepository.create({ userId: input.userId, bio: input.bio, avatarUrl: input.avatarUrl });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_CREATED",
      resourceType: "author",
      resourceId: author.id,
      afterData: { userId: input.userId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return author;
  },
  async updateAuthor(caller, id, input, meta = {}) {
    const existing = await loadAuthorOrThrow(id);
    const patch = {};
    if (input.bio !== void 0) patch.bio = input.bio;
    if (input.avatarUrl !== void 0) patch.avatarUrl = input.avatarUrl;
    const updated = await authorRepository.update(id, patch);
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_UPDATED",
      resourceType: "author",
      resourceId: id,
      beforeData: { bio: existing.bio, avatarUrl: existing.avatarUrl },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  }
};

// server/schemas/authorSchemas.ts
import { z as z18 } from "zod";
var createAuthorSchema = z18.object({
  userId: z18.string().trim().uuid(),
  bio: z18.string().trim().max(2e3).optional(),
  avatarUrl: z18.string().trim().url().max(500).optional()
});
var updateAuthorSchema = z18.object({
  bio: z18.string().trim().max(2e3).nullable().optional(),
  avatarUrl: z18.string().trim().url().max(500).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/authorRoutes.ts
var router22 = Router22();
router22.use(authenticateToken);
function requestMeta14(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router22.get(
  "/",
  requirePermission("authors.read"),
  asyncHandler(async (_req, res) => {
    const authors = await authorService.listAuthors();
    sendSuccess(res, { authors });
  })
);
router22.get(
  "/:id",
  requirePermission("authors.read"),
  asyncHandler(async (req, res) => {
    const author = await authorService.getAuthor(req.params.id);
    sendSuccess(res, { author });
  })
);
router22.post(
  "/",
  requirePermission("authors.create"),
  asyncHandler(async (req, res) => {
    const input = createAuthorSchema.parse(req.body);
    const author = await authorService.createAuthor(req.user, input, requestMeta14(req));
    sendSuccess(res, { author }, 201);
  })
);
router22.patch(
  "/:id",
  requirePermission("authors.update"),
  asyncHandler(async (req, res) => {
    const input = updateAuthorSchema.parse(req.body);
    const author = await authorService.updateAuthor(req.user, req.params.id, input, requestMeta14(req));
    sendSuccess(res, { author });
  })
);
var authorRoutes_default = router22;

// server/routes/v1/mediaRoutes.ts
import { Router as Router23 } from "express";
import express2 from "express";

// server/schemas/mediaSchemas.ts
import { z as z19 } from "zod";
var SORT_FIELDS3 = ["originalFilename", "displayName", "mimeType", "sizeBytes", "status", "createdAt", "updatedAt"];
var listMediaQuerySchema = z19.object({
  page: z19.coerce.number().int().positive().default(1),
  limit: z19.coerce.number().int().positive().max(100).default(20),
  search: z19.string().trim().max(200).optional(),
  status: z19.enum(["PENDING", "ACTIVE", "FAILED", "ARCHIVED"]).optional(),
  mimeType: z19.enum(ALLOWED_MIME_TYPES).optional(),
  uploadedById: z19.string().trim().uuid().optional(),
  dateFrom: z19.coerce.date().optional(),
  dateTo: z19.coerce.date().optional(),
  sort: z19.enum(SORT_FIELDS3).default("createdAt"),
  order: z19.enum(["asc", "desc"]).default("desc")
});
var createUploadSessionSchema = z19.object({
  filename: z19.string().trim().min(1).max(255),
  mimeType: z19.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z19.number().int().positive(),
  displayName: z19.string().trim().max(255).optional(),
  altText: z19.string().trim().max(500).optional(),
  caption: z19.string().trim().max(1e3).optional()
});
var completeUploadSchema = z19.object({
  token: z19.string().trim().min(1)
});
var updateMediaSchema = z19.object({
  displayName: z19.string().trim().max(255).nullable().optional(),
  altText: z19.string().trim().max(500).nullable().optional(),
  caption: z19.string().trim().max(1e3).nullable().optional(),
  visibility: z19.enum(["PRIVATE", "PUBLIC"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/mediaRoutes.ts
var router23 = Router23();
function requestMeta15(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router23.put(
  "/local-object",
  express2.raw({ type: () => true, limit: Math.max(config.mediaMaxImageSizeBytes, config.mediaMaxDocumentSizeBytes) }),
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("upload", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired upload authorization." });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    await localFilesystemStorageProvider.writeObject(key, body);
    res.status(200).json({ ok: true });
  })
);
router23.get(
  "/local-object",
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("read", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired read authorization." });
      return;
    }
    try {
      const bytes = await localFilesystemStorageProvider.readObject(key);
      res.status(200).end(bytes);
    } catch {
      res.status(404).json({ error: "Object not found." });
    }
  })
);
router23.use(authenticateToken);
router23.get(
  "/",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const query = listMediaQuerySchema.parse(req.query);
    const { rows, total } = await mediaService.listMedia(
      req.user.organizationId,
      { search: query.search, status: query.status, mimeType: query.mimeType, uploadedById: query.uploadedById, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { media: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router23.get(
  "/:id",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.getMedia(req.user.organizationId, req.params.id);
    sendSuccess(res, { media });
  })
);
router23.get(
  "/:id/url",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const result = await mediaService.getReadUrl(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, result);
  })
);
router23.post(
  "/upload-session",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = createUploadSessionSchema.parse(req.body);
    const result = await mediaService.createUploadSession(req.user, input, requestMeta15(req));
    sendSuccess(res, result, 201);
  })
);
router23.post(
  "/:id/complete",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = completeUploadSchema.parse(req.body);
    if (!input.token) throw new ValidationError("token is required.");
    const media = await mediaService.completeUpload(req.user, req.params.id, input.token, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.patch(
  "/:id",
  requirePermission("media.update"),
  asyncHandler(async (req, res) => {
    const input = updateMediaSchema.parse(req.body);
    const media = await mediaService.updateMedia(req.user, req.params.id, input, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.post(
  "/:id/archive",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.archiveMedia(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.delete(
  "/:id",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    await mediaService.deleteMedia(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, { message: "Media deleted." });
  })
);
var mediaRoutes_default = router23;

// server/routes/v1/contractRoutes.ts
import { Router as Router24 } from "express";

// server/repositories/contractRepository.ts
var withVariations = { include: { variations: { orderBy: { variationNumber: "asc" } } } };
function buildWhere9(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.search) {
    where.OR = [
      { contractNumber: { contains: filters.search, mode: "insensitive" } },
      { title: { contains: filters.search, mode: "insensitive" } }
    ];
  }
  return where;
}
var contractRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere9(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.contract.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withVariations }),
      prisma.contract.count({ where })
    ]);
    return { rows, total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped (§25 IDOR requirement). */
  async findByIdInOrg(id, organizationId) {
    return prisma.contract.findFirst({ where: { id, organizationId }, ...withVariations });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.contract.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },
  async create(data) {
    return prisma.contract.create({ data });
  },
  async update(id, data) {
    return prisma.contract.update({ where: { id }, data });
  },
  /**
   * Race-safe conditional status transition — `WHERE id = ? AND status IN
   * (...)`, the same conditional-updateMany-plus-row-count pattern used
   * throughout this codebase since Phase 5 (lead conversion, workspace
   * provisioning, CMS optimistic concurrency, Phase 9 media). Returns the
   * affected row count so the caller can distinguish a genuine race from
   * success without a separate read-then-write.
   */
  async transitionStatus(id, fromStatuses, toStatus) {
    const result = await prisma.contract.updateMany({
      where: { id, status: { in: fromStatuses } },
      data: { status: toStatus }
    });
    return result.count;
  },
  async createVariation(data) {
    return prisma.contractVariation.create({ data });
  },
  async lastVariationNumber(tx, contractId) {
    const last = await tx.contractVariation.findFirst({ where: { contractId }, orderBy: { variationNumber: "desc" } });
    return last?.variationNumber ?? 0;
  },
  /** Row-locks the parent Contract so concurrent variation creates against the same contract serialize instead of racing on `variationNumber` (§37). */
  async lockForVariation(tx, id) {
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
  }
};

// server/utils/money.ts
import { Prisma as Prisma4 } from "@prisma/client";
var MONEY_DECIMALS = 3;
var DEFAULT_CURRENCY = "OMR";
function toMoney(value) {
  return new Prisma4.Decimal(value);
}
var ZERO = toMoney(0);
function roundMoney(value) {
  return new Prisma4.Decimal(value).toDecimalPlaces(MONEY_DECIMALS, Prisma4.Decimal.ROUND_HALF_UP);
}
function addMoney(a, b) {
  return roundMoney(new Prisma4.Decimal(a).plus(b));
}
function subtractMoney(a, b) {
  return roundMoney(new Prisma4.Decimal(a).minus(b));
}
function sumMoney(values) {
  return roundMoney(values.reduce((acc, v) => acc.plus(v), new Prisma4.Decimal(0)));
}
function multiplyMoney(unitPrice, quantity) {
  return roundMoney(new Prisma4.Decimal(unitPrice).times(quantity));
}
function isPositive(value) {
  return new Prisma4.Decimal(value).greaterThan(0);
}
function isNonNegative(value) {
  return new Prisma4.Decimal(value).greaterThanOrEqualTo(0);
}
function assertSameCurrency(a, b, context = "these records") {
  if (a !== b) {
    throw new ValidationError(`Currency mismatch: ${context} use different currencies (${a} vs ${b}).`);
  }
}

// server/services/billingCalculations.ts
function calculateLineItem(input) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new ValidationError("Line item quantity must be a positive integer.");
  }
  const gross = multiplyMoney(input.unitPrice, input.quantity);
  const lineTotal = subtractMoney(gross, input.discount);
  if (!isNonNegative(lineTotal)) {
    throw new ValidationError("A line item's discount cannot exceed its quantity \xD7 unit price.");
  }
  return { ...input, lineTotal };
}
function calculateInvoiceTotals(lines, invoiceDiscount, tax) {
  const subtotal = sumMoney(lines.map((l) => l.lineTotal));
  const total = addMoney(subtractMoney(subtotal, invoiceDiscount), tax);
  if (!isNonNegative(total)) {
    throw new ValidationError("Invoice discount cannot exceed subtotal plus tax.");
  }
  return { subtotal, total };
}
function calculateInvoiceBalance(total, completedPaymentAmounts) {
  const amountPaid = sumMoney(completedPaymentAmounts);
  const amountDue = subtractMoney(total, amountPaid);
  return { amountPaid, amountDue: isNonNegative(amountDue) ? amountDue : toMoney(0) };
}
function calculateContractCurrentValue(originalValue, variationAmounts) {
  return addMoney(originalValue, sumMoney(variationAmounts));
}
function effectiveInvoiceStatus(invoice, now = /* @__PURE__ */ new Date()) {
  if ((invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate.getTime() < now.getTime()) {
    return "OVERDUE";
  }
  return invoice.status;
}

// server/utils/sequence.ts
var SEQUENCES = {
  contract: "contract_number_seq",
  subscription: "subscription_number_seq",
  invoice: "invoice_number_seq"
};
async function nextSequenceValue(kind) {
  const rows = await prisma.$queryRawUnsafe(`SELECT nextval('${SEQUENCES[kind]}') AS nextval`);
  return Number(rows[0].nextval);
}
function pad(value) {
  return String(value).padStart(6, "0");
}
async function nextContractNumber() {
  return `CTR-${pad(await nextSequenceValue("contract"))}`;
}
async function nextSubscriptionNumber() {
  return `SUB-${pad(await nextSequenceValue("subscription"))}`;
}
async function nextInvoiceNumber() {
  return `INV-${pad(await nextSequenceValue("invoice"))}`;
}

// server/services/contractService.ts
var ACTIVATABLE_FROM = ["DRAFT", "SUSPENDED"];
var SUSPENDABLE_FROM = ["ACTIVE"];
var TERMINABLE_FROM = ["DRAFT", "ACTIVE", "SUSPENDED"];
function withCurrentValue(contract) {
  return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
}
async function loadContractOrThrow(id, organizationId) {
  const contract = await contractRepository.findByIdInOrg(id, organizationId);
  if (!contract) throw new NotFoundError("Contract not found.");
  return contract;
}
async function assertClientInOrg2(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
}
var contractService = {
  async listContracts(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await contractRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withCurrentValue), total };
  },
  async getContract(organizationId, id) {
    return withCurrentValue(await loadContractOrThrow(id, organizationId));
  },
  async createContract(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    await assertClientInOrg2(input.clientId, organizationId);
    if (input.endDate && input.endDate.getTime() < input.startDate.getTime()) {
      throw new ValidationError("endDate cannot be before startDate.");
    }
    const contractNumber = await nextContractNumber();
    const contract = await contractRepository.create({
      contractNumber,
      organizationId,
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      contractValue: toMoney(input.contractValue),
      currency: input.currency ?? DEFAULT_CURRENCY,
      notes: input.notes,
      createdById: caller.id
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_CREATED",
      resourceType: "contract",
      resourceId: contract.id,
      afterData: { contractNumber, clientId: input.clientId, contractValue: contract.contractValue.toString(), currency: contract.currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, contract.id);
  },
  async updateContract(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be edited.`);
    }
    const patch = {};
    if (input.title !== void 0) patch.title = input.title;
    if (input.description !== void 0) patch.description = input.description;
    if (input.endDate !== void 0) patch.endDate = input.endDate;
    if (input.notes !== void 0) patch.notes = input.notes;
    const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
    const result = await prisma.contract.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This contract was changed by someone else since you loaded it. Reload and try again.");
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_UPDATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { title: existing.title },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async activateContract(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, ACTIVATABLE_FROM, "ACTIVE");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to ACTIVE.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_ACTIVATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async suspendContract(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, SUSPENDABLE_FROM, "SUSPENDED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to SUSPENDED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_SUSPENDED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SUSPENDED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async terminateContract(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, TERMINABLE_FROM, "TERMINATED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to TERMINATED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_TERMINATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "TERMINATED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async createVariation(caller, contractId, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(contractId, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be varied.`);
    }
    const amount = toMoney(input.amount);
    if (amount.isZero()) throw new ValidationError("A contract variation's amount cannot be zero.");
    await prisma.$transaction(async (tx) => {
      await contractRepository.lockForVariation(tx, contractId);
      const nextNumber = await contractRepository.lastVariationNumber(tx, contractId) + 1;
      await tx.contractVariation.create({
        data: { contractId, variationNumber: nextNumber, amount, effectiveDate: input.effectiveDate, reason: input.reason, createdById: caller.id }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_VARIATION_CREATED",
      resourceType: "contract",
      resourceId: contractId,
      afterData: { amount: amount.toString(), effectiveDate: input.effectiveDate, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, contractId);
  }
};

// server/schemas/contractSchemas.ts
import { z as z21 } from "zod";

// server/schemas/commercialSchemas.ts
import { z as z20 } from "zod";
var expectedUpdatedAtSchema2 = z20.coerce.date().optional();
var currencyCodeSchema = z20.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").default(DEFAULT_CURRENCY);
var moneyAmountSchema = z20.union([z20.string(), z20.number()]).transform((v) => String(v).trim()).refine((v) => /^\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a non-negative number with at most 3 decimal places" });
var signedMoneyAmountSchema = z20.union([z20.string(), z20.number()]).transform((v) => String(v).trim()).refine((v) => /^-?\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a number with at most 3 decimal places" });
var SORT_ORDER = ["asc", "desc"];
function paginationQuerySchema(sortFields, defaultSort, defaultOrder = "desc") {
  return {
    page: z20.coerce.number().int().positive().default(1),
    limit: z20.coerce.number().int().positive().max(100).default(20),
    search: z20.string().trim().max(200).optional(),
    sort: z20.enum(sortFields).default(defaultSort),
    order: z20.enum(SORT_ORDER).default(defaultOrder)
  };
}

// server/schemas/contractSchemas.ts
var contractStatusSchema = z21.enum(["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]);
var SORT_FIELDS4 = ["contractNumber", "title", "status", "startDate", "endDate", "createdAt", "updatedAt"];
var listContractsQuerySchema = z21.object({
  ...paginationQuerySchema(SORT_FIELDS4, "createdAt"),
  status: contractStatusSchema.optional(),
  clientId: z21.string().trim().uuid().optional()
});
var createContractSchema = z21.object({
  clientId: z21.string().trim().uuid(),
  title: z21.string().trim().min(1).max(200),
  description: z21.string().trim().max(5e3).optional(),
  startDate: z21.coerce.date(),
  endDate: z21.coerce.date().optional(),
  contractValue: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  notes: z21.string().trim().max(5e3).optional()
});
var updateContractSchema = z21.object({
  title: z21.string().trim().min(1).max(200).optional(),
  description: z21.string().trim().max(5e3).nullable().optional(),
  endDate: z21.coerce.date().nullable().optional(),
  notes: z21.string().trim().max(5e3).nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var terminateContractSchema = z21.object({
  reason: z21.string().trim().min(1).max(1e3)
});
var createContractVariationSchema = z21.object({
  amount: signedMoneyAmountSchema,
  effectiveDate: z21.coerce.date(),
  reason: z21.string().trim().min(1).max(1e3)
});

// server/routes/v1/contractRoutes.ts
var router24 = Router24();
router24.use(authenticateToken);
function requestMeta16(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router24.get(
  "/",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const query = listContractsQuerySchema.parse(req.query);
    const { rows, total } = await contractService.listContracts(
      req.user.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router24.get(
  "/:id",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.getContract(req.user.organizationId, req.params.id);
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/",
  requirePermission("contracts.create"),
  asyncHandler(async (req, res) => {
    const input = createContractSchema.parse(req.body);
    const contract = await contractService.createContract(req.user, input, requestMeta16(req));
    sendSuccess(res, { contract }, 201);
  })
);
router24.patch(
  "/:id",
  requirePermission("contracts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContractSchema.parse(req.body);
    const contract = await contractService.updateContract(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/activate",
  requirePermission("contracts.activate"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.activateContract(req.user, req.params.id, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/suspend",
  requirePermission("contracts.suspend"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.suspendContract(req.user, req.params.id, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/terminate",
  requirePermission("contracts.terminate"),
  asyncHandler(async (req, res) => {
    const input = terminateContractSchema.parse(req.body);
    const contract = await contractService.terminateContract(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/variations",
  requirePermission("contracts.variations.create"),
  asyncHandler(async (req, res) => {
    const input = createContractVariationSchema.parse(req.body);
    const contract = await contractService.createVariation(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract }, 201);
  })
);
var contractRoutes_default = router24;

// server/routes/v1/subscriptionRoutes.ts
import { Router as Router25 } from "express";

// server/repositories/subscriptionRepository.ts
var withItems = { include: { items: true } };
function buildWhere10(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.productId) where.productId = filters.productId;
  if (filters.search) where.subscriptionNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}
var subscriptionRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere10(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.subscription.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.subscription.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.subscription.findFirst({ where: { id, organizationId }, ...withItems });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.subscription.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },
  async create(data, items) {
    return prisma.subscription.create({
      data: {
        subscriptionNumber: data.subscriptionNumber,
        organizationId: data.organizationId,
        clientId: data.clientId,
        productId: data.productId,
        startDate: data.startDate,
        billingCycle: data.billingCycle,
        quantity: data.quantity,
        price: data.price,
        currency: data.currency,
        createdById: data.createdById,
        items: { create: items }
      },
      ...withItems
    });
  },
  async update(id, data) {
    return prisma.subscription.update({ where: { id }, data });
  },
  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id, fromStatuses, data) {
    const result = await prisma.subscription.updateMany({
      where: { id, status: { in: fromStatuses } },
      data
    });
    return result.count;
  }
};

// server/services/subscriptionService.ts
var ACTIVATABLE_FROM2 = ["DRAFT", "TRIALING", "PAUSED"];
var PAUSABLE_FROM = ["ACTIVE", "PAST_DUE"];
var CANCELLABLE_FROM = ["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"];
async function loadSubscriptionOrThrow(id, organizationId) {
  const subscription = await subscriptionRepository.findByIdInOrg(id, organizationId);
  if (!subscription) throw new NotFoundError("Subscription not found.");
  return subscription;
}
var subscriptionService = {
  async listSubscriptions(organizationId, filters, page, limit, sort, order) {
    return subscriptionRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getSubscription(organizationId, id) {
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async createSubscription(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    const client3 = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
    const product = await productRepository.findById(input.productId);
    if (!product) throw new ValidationError("The specified product does not exist.");
    const currency = input.currency ?? DEFAULT_CURRENCY;
    for (const item of input.items) {
      if (item.productModuleId) {
        const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, input.productId);
        if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the selected product.`);
      }
    }
    const subscriptionNumber = await nextSubscriptionNumber();
    const subscription = await subscriptionRepository.create(
      {
        subscriptionNumber,
        organizationId,
        clientId: input.clientId,
        productId: input.productId,
        startDate: input.startDate,
        billingCycle: input.billingCycle,
        quantity: input.quantity,
        price: toMoney(input.price),
        currency,
        createdById: caller.id
      },
      input.items.map((item) => ({
        productModuleId: item.productModuleId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: toMoney(item.unitPrice),
        currency
      }))
    );
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CREATED",
      resourceType: "subscription",
      resourceId: subscription.id,
      afterData: { subscriptionNumber, clientId: input.clientId, productId: input.productId, price: subscription.price.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return subscription;
  },
  async updateSubscription(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} subscription can no longer be edited.`);
    }
    const patch = {};
    if (input.renewalDate !== void 0) patch.renewalDate = input.renewalDate;
    if (input.endDate !== void 0) patch.endDate = input.endDate;
    if (input.quantity !== void 0) patch.quantity = input.quantity;
    if (input.price !== void 0) patch.price = toMoney(input.price);
    const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
    const result = await prisma.subscription.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This subscription was changed by someone else since you loaded it. Reload and try again.");
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_UPDATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { quantity: existing.quantity, price: existing.price.toString() },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async activateSubscription(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, ACTIVATABLE_FROM2, { status: "ACTIVE" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to ACTIVE.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_ACTIVATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async pauseSubscription(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, PAUSABLE_FROM, { status: "PAUSED" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to PAUSED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_PAUSED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PAUSED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async cancelSubscription(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const now = /* @__PURE__ */ new Date();
    const count = await subscriptionRepository.transitionStatus(id, CANCELLABLE_FROM, {
      status: "CANCELLED",
      cancelledAt: now,
      cancellationReason: input.reason,
      cancelledById: caller.id
    });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to CANCELLED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CANCELLED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "CANCELLED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  }
};

// server/schemas/subscriptionSchemas.ts
import { z as z22 } from "zod";
var subscriptionStatusSchema = z22.enum(["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"]);
var billingCycleSchema = z22.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"]);
var SORT_FIELDS5 = ["subscriptionNumber", "status", "startDate", "renewalDate", "createdAt", "updatedAt"];
var listSubscriptionsQuerySchema = z22.object({
  ...paginationQuerySchema(SORT_FIELDS5, "createdAt"),
  status: subscriptionStatusSchema.optional(),
  clientId: z22.string().trim().uuid().optional(),
  productId: z22.string().trim().uuid().optional()
});
var subscriptionItemInputSchema = z22.object({
  productModuleId: z22.string().trim().uuid().optional(),
  description: z22.string().trim().min(1).max(500),
  quantity: z22.number().int().positive().default(1),
  unitPrice: moneyAmountSchema
});
var createSubscriptionSchema = z22.object({
  clientId: z22.string().trim().uuid(),
  productId: z22.string().trim().uuid(),
  startDate: z22.coerce.date(),
  billingCycle: billingCycleSchema,
  quantity: z22.number().int().positive().default(1),
  price: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  items: z22.array(subscriptionItemInputSchema).default([])
});
var updateSubscriptionSchema = z22.object({
  renewalDate: z22.coerce.date().nullable().optional(),
  endDate: z22.coerce.date().nullable().optional(),
  quantity: z22.number().int().positive().optional(),
  price: moneyAmountSchema.optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var cancelSubscriptionSchema = z22.object({
  reason: z22.string().trim().min(1).max(1e3)
});

// server/routes/v1/subscriptionRoutes.ts
var router25 = Router25();
router25.use(authenticateToken);
function requestMeta17(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router25.get(
  "/",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = listSubscriptionsQuerySchema.parse(req.query);
    const { rows, total } = await subscriptionService.listSubscriptions(
      req.user.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId, productId: query.productId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router25.get(
  "/:id",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.getSubscription(req.user.organizationId, req.params.id);
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/",
  requirePermission("subscriptions.create"),
  asyncHandler(async (req, res) => {
    const input = createSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.createSubscription(req.user, input, requestMeta17(req));
    sendSuccess(res, { subscription }, 201);
  })
);
router25.patch(
  "/:id",
  requirePermission("subscriptions.update"),
  asyncHandler(async (req, res) => {
    const input = updateSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.updateSubscription(req.user, req.params.id, input, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/activate",
  requirePermission("subscriptions.activate"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.activateSubscription(req.user, req.params.id, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/pause",
  requirePermission("subscriptions.pause"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.pauseSubscription(req.user, req.params.id, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/cancel",
  requirePermission("subscriptions.cancel"),
  asyncHandler(async (req, res) => {
    const input = cancelSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.cancelSubscription(req.user, req.params.id, input, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
var subscriptionRoutes_default = router25;

// server/routes/v1/invoiceRoutes.ts
import { Router as Router26 } from "express";

// server/repositories/invoiceRepository.ts
var withItemsAndPayments = { include: { items: true, payments: { orderBy: { createdAt: "asc" } } } };
function buildWhere11(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.contractId) where.contractId = filters.contractId;
  if (filters.subscriptionId) where.subscriptionId = filters.subscriptionId;
  if (filters.dateFrom || filters.dateTo) {
    where.issueDate = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) where.invoiceNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}
var invoiceRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere11(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.invoice.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.invoice.findFirst({ where: { id, organizationId }, ...withItemsAndPayments });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.invoice.findMany({ where: { clientId, organizationId }, orderBy: { issueDate: "desc" } });
  },
  async create(data, items) {
    return prisma.invoice.create({
      data: { ...data, items: { create: items } },
      ...withItemsAndPayments
    });
  },
  async update(id, data) {
    return prisma.invoice.update({ where: { id }, data });
  },
  async replaceItems(tx, invoiceId, items) {
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoiceItem.createMany({ data: items.map((item) => ({ ...item, invoiceId })) });
  },
  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id, fromStatuses, data) {
    const result = await prisma.invoice.updateMany({
      where: { id, status: { in: fromStatuses } },
      data
    });
    return result.count;
  },
  /** Serializes concurrent payment record/reversal against the same invoice — required because those operations read a computed sum (Σ completed payments) and validate against it before writing, which a plain conditional updateMany cannot express (§37). */
  async lockForPayment(tx, id) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
  },
  async completedPaymentAmounts(tx, invoiceId) {
    const rows = await tx.payment.findMany({ where: { invoiceId, status: "COMPLETED" }, select: { amount: true } });
    return rows.map((r) => r.amount);
  }
};

// server/repositories/paymentRepository.ts
function buildWhere12(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.method) where.method = filters.method;
  if (filters.invoiceId) where.invoiceId = filters.invoiceId;
  if (filters.clientId) where.invoice = { clientId: filters.clientId };
  if (filters.dateFrom || filters.dateTo) {
    where.paymentDate = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  return where;
}
var paymentRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere12(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.payment.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.payment.findFirst({ where: { id, organizationId } });
  },
  async listForInvoiceInOrg(invoiceId, organizationId) {
    return prisma.payment.findMany({ where: { invoiceId, organizationId }, orderBy: { createdAt: "asc" } });
  },
  async create(tx, data) {
    return tx.payment.create({
      data: {
        invoiceId: data.invoiceId,
        organizationId: data.organizationId,
        amount: data.amount,
        currency: data.currency,
        paymentDate: data.paymentDate,
        method: data.method,
        reference: data.reference,
        notes: data.notes,
        createdById: data.createdById,
        status: "COMPLETED"
      }
    });
  },
  /** Race-safe conditional reversal — only a COMPLETED payment can be reversed, and the invoice row must already be locked (FOR UPDATE) by the caller within the same transaction (§37). */
  async reverse(tx, id, data) {
    const result = await tx.payment.updateMany({
      where: { id, status: "COMPLETED" },
      data: { status: "REVERSED", reversalReason: data.reversalReason, reversedById: data.reversedById, reversedAt: data.reversedAt }
    });
    return result.count;
  }
};

// server/services/invoiceService.ts
var ISSUABLE_FROM = ["DRAFT"];
var PAYABLE_STATUSES = ["ISSUED", "PARTIALLY_PAID"];
function withEffectiveStatus(invoice) {
  return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
}
function statusForBalance(amountPaid, amountDue) {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}
async function loadInvoiceOrThrow(id, organizationId) {
  const invoice = await invoiceRepository.findByIdInOrg(id, organizationId);
  if (!invoice) throw new NotFoundError("Invoice not found.");
  return invoice;
}
async function buildLineItems(items, productId) {
  const calculated = items.map((item) => calculateLineItem({ quantity: item.quantity, unitPrice: toMoney(item.unitPrice), discount: toMoney(item.discount) }));
  for (const item of items) {
    if (item.productModuleId && productId) {
      const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, productId);
      if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the linked subscription's product.`);
    }
  }
  return items.map((item, i) => ({
    productModuleId: item.productModuleId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: calculated[i].unitPrice,
    discount: calculated[i].discount,
    lineTotal: calculated[i].lineTotal
  }));
}
var invoiceService = {
  async listInvoices(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await invoiceRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map((row) => ({ ...row, effectiveStatus: effectiveInvoiceStatus(row) })), total };
  },
  async getInvoice(organizationId, id) {
    return withEffectiveStatus(await loadInvoiceOrThrow(id, organizationId));
  },
  async createInvoice(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    const client3 = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
    let productId;
    if (input.contractId) {
      const contract = await contractRepository.findByIdInOrg(input.contractId, organizationId);
      if (!contract || contract.clientId !== input.clientId) throw new ValidationError("The specified contract does not belong to this client.");
    }
    if (input.subscriptionId) {
      const subscription = await subscriptionRepository.findByIdInOrg(input.subscriptionId, organizationId);
      if (!subscription || subscription.clientId !== input.clientId) throw new ValidationError("The specified subscription does not belong to this client.");
      productId = subscription.productId;
    }
    if (input.dueDate.getTime() < input.issueDate.getTime()) {
      throw new ValidationError("dueDate cannot be before issueDate.");
    }
    const currency = input.currency ?? DEFAULT_CURRENCY;
    const lines = await buildLineItems(input.items, productId);
    const calculatedLines = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal }));
    const { subtotal, total } = calculateInvoiceTotals(calculatedLines, toMoney(input.discount), toMoney(input.tax));
    const { amountDue } = calculateInvoiceBalance(total, []);
    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await invoiceRepository.create(
      {
        invoiceNumber,
        organizationId,
        clientId: input.clientId,
        contractId: input.contractId,
        subscriptionId: input.subscriptionId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency,
        subtotal,
        tax: toMoney(input.tax),
        discount: toMoney(input.discount),
        total,
        amountDue,
        notes: input.notes,
        createdById: caller.id
      },
      lines
    );
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_CREATED",
      resourceType: "invoice",
      resourceId: invoice.id,
      afterData: { invoiceNumber, clientId: input.clientId, total: total.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return withEffectiveStatus(invoice);
  },
  async updateInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") {
      throw new ConflictError("Only a DRAFT invoice can be edited \u2014 once issued, an invoice is immutable (correct via credit/void instead).");
    }
    const issueDate = input.issueDate ?? existing.issueDate;
    const dueDate = input.dueDate ?? existing.dueDate;
    if (dueDate.getTime() < issueDate.getTime()) throw new ValidationError("dueDate cannot be before issueDate.");
    await prisma.$transaction(async (tx) => {
      const patch = {};
      if (input.issueDate !== void 0) patch.issueDate = input.issueDate;
      if (input.dueDate !== void 0) patch.dueDate = input.dueDate;
      if (input.notes !== void 0) patch.notes = input.notes;
      let lines = existing.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, lineTotal: item.lineTotal }));
      if (input.items !== void 0) {
        const built = await buildLineItems(input.items, void 0);
        await invoiceRepository.replaceItems(tx, id, built);
        lines = built;
      }
      const discount = input.discount !== void 0 ? toMoney(input.discount) : existing.discount;
      const tax = input.tax !== void 0 ? toMoney(input.tax) : existing.tax;
      const { subtotal, total } = calculateInvoiceTotals(lines, discount, tax);
      const { amountDue } = calculateInvoiceBalance(total, []);
      patch.discount = discount;
      patch.tax = tax;
      patch.subtotal = subtotal;
      patch.total = total;
      patch.amountDue = amountDue;
      const where = {
        id,
        status: "DRAFT",
        ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {}
      };
      const result = await tx.invoice.updateMany({ where, data: patch });
      if (result.count === 0) {
        throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");
      }
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_UPDATED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async issueInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.items.length === 0) throw new ValidationError("An invoice needs at least one line item before it can be issued.");
    const where = {
      id,
      status: { in: ISSUABLE_FROM },
      ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {}
    };
    const result = await prisma.invoice.updateMany({ where, data: { status: "ISSUED" } });
    if (result.count === 0) {
      throw new ConflictError(`Invoice cannot be issued from status ${existing.status}, or it was changed by someone else. Reload and try again.`);
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_ISSUED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ISSUED", total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async voidInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status === "VOID" || existing.status === "CANCELLED" || existing.status === "PAID") {
      throw new ConflictError(`An invoice with status ${existing.status} cannot be voided.`);
    }
    if (isPositive(existing.amountPaid)) {
      throw new ConflictError("This invoice has completed payments \u2014 reverse them before voiding the invoice.");
    }
    const targetStatus = existing.status === "DRAFT" ? "CANCELLED" : "VOID";
    const count = await invoiceRepository.transitionStatus(id, [existing.status], { status: targetStatus, voidReason: input.reason });
    if (count === 0) throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: targetStatus === "VOID" ? "INVOICE_VOIDED" : "INVOICE_CANCELLED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: targetStatus, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async recordPayment(caller, invoiceId, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(invoiceId, organizationId);
    const amount = toMoney(input.amount);
    if (!isPositive(amount)) throw new ValidationError("Payment amount must be positive.");
    const currency = input.currency ?? existing.currency;
    assertSameCurrency(currency, existing.currency, "the payment and the invoice");
    const payment = await prisma.$transaction(async (tx) => {
      await invoiceRepository.lockForPayment(tx, invoiceId);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!PAYABLE_STATUSES.includes(fresh.status)) {
        throw new ConflictError(`Payments can only be recorded against an issued invoice (current status: ${fresh.status}).`);
      }
      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, invoiceId);
      const before = calculateInvoiceBalance(fresh.total, completedAmounts);
      if (amount.greaterThan(before.amountDue)) {
        throw new ValidationError(`Payment amount (${amount.toString()}) exceeds the outstanding balance of ${before.amountDue.toString()}.`);
      }
      const created = await paymentRepository.create(tx, {
        invoiceId,
        organizationId,
        amount,
        currency,
        paymentDate: input.paymentDate,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        createdById: caller.id
      });
      const after = calculateInvoiceBalance(fresh.total, [...completedAmounts, amount]);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: after.amountPaid, amountDue: after.amountDue, status: statusForBalance(after.amountPaid, after.amountDue) }
      });
      return created;
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_RECORDED",
      resourceType: "payment",
      resourceId: payment.id,
      afterData: { invoiceId, amount: amount.toString(), currency, method: input.method },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return payment;
  }
};

// server/services/paymentService.ts
function statusForBalance2(amountPaid, amountDue) {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}
async function loadPaymentOrThrow(id, organizationId) {
  const payment = await paymentRepository.findByIdInOrg(id, organizationId);
  if (!payment) throw new NotFoundError("Payment not found.");
  return payment;
}
var paymentService = {
  async listPayments(organizationId, filters, page, limit, sort, order) {
    return paymentRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPayment(organizationId, id) {
    return loadPaymentOrThrow(id, organizationId);
  },
  async reversePayment(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPaymentOrThrow(id, organizationId);
    if (existing.status !== "COMPLETED") {
      throw new ConflictError(`Only a COMPLETED payment can be reversed (current status: ${existing.status}).`);
    }
    const reversedAt = /* @__PURE__ */ new Date();
    await prisma.$transaction(async (tx) => {
      await invoiceRepository.lockForPayment(tx, existing.invoiceId);
      const result = await tx.payment.updateMany({
        where: { id, status: "COMPLETED" },
        data: { status: "REVERSED", reversalReason: input.reason, reversedById: caller.id, reversedAt }
      });
      if (result.count === 0) throw new ConflictError("This payment was already reversed by someone else.");
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: existing.invoiceId } });
      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, existing.invoiceId);
      const balance = calculateInvoiceBalance(invoice.total, completedAmounts);
      await tx.invoice.update({
        where: { id: existing.invoiceId },
        data: { amountPaid: balance.amountPaid, amountDue: balance.amountDue, status: statusForBalance2(balance.amountPaid, balance.amountDue) }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_REVERSED",
      resourceType: "payment",
      resourceId: id,
      beforeData: { status: "COMPLETED", amount: existing.amount.toString() },
      afterData: { status: "REVERSED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPaymentOrThrow(id, organizationId);
  }
};

// server/schemas/invoiceSchemas.ts
import { z as z23 } from "zod";
var invoiceStatusSchema = z23.enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "CANCELLED"]);
var paymentMethodSchema = z23.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"]);
var paymentStatusSchema = z23.enum(["PENDING", "COMPLETED", "FAILED", "REVERSED"]);
var SORT_FIELDS6 = ["invoiceNumber", "status", "issueDate", "dueDate", "total", "amountDue", "createdAt", "updatedAt"];
var listInvoicesQuerySchema = z23.object({
  ...paginationQuerySchema(SORT_FIELDS6, "issueDate"),
  status: invoiceStatusSchema.optional(),
  clientId: z23.string().trim().uuid().optional(),
  contractId: z23.string().trim().uuid().optional(),
  subscriptionId: z23.string().trim().uuid().optional(),
  dateFrom: z23.coerce.date().optional(),
  dateTo: z23.coerce.date().optional()
});
var invoiceItemInputSchema = z23.object({
  productModuleId: z23.string().trim().uuid().optional(),
  description: z23.string().trim().min(1).max(500),
  quantity: z23.number().int().positive().default(1),
  unitPrice: moneyAmountSchema,
  discount: moneyAmountSchema.default("0")
});
var createInvoiceSchema = z23.object({
  clientId: z23.string().trim().uuid(),
  contractId: z23.string().trim().uuid().optional(),
  subscriptionId: z23.string().trim().uuid().optional(),
  issueDate: z23.coerce.date(),
  dueDate: z23.coerce.date(),
  currency: currencyCodeSchema.optional(),
  discount: moneyAmountSchema.default("0"),
  tax: moneyAmountSchema.default("0"),
  notes: z23.string().trim().max(5e3).optional(),
  items: z23.array(invoiceItemInputSchema).min(1, "An invoice needs at least one line item.")
});
var updateInvoiceSchema = z23.object({
  issueDate: z23.coerce.date().optional(),
  dueDate: z23.coerce.date().optional(),
  discount: moneyAmountSchema.optional(),
  tax: moneyAmountSchema.optional(),
  notes: z23.string().trim().max(5e3).nullable().optional(),
  items: z23.array(invoiceItemInputSchema).min(1).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var issueInvoiceSchema = z23.object({ expectedUpdatedAt: expectedUpdatedAtSchema2 });
var voidInvoiceSchema = z23.object({
  reason: z23.string().trim().min(1).max(1e3)
});
var recordPaymentSchema = z23.object({
  amount: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  paymentDate: z23.coerce.date(),
  method: paymentMethodSchema,
  reference: z23.string().trim().max(200).optional(),
  notes: z23.string().trim().max(2e3).optional()
});

// server/routes/v1/invoiceRoutes.ts
var router26 = Router26();
router26.use(authenticateToken);
function requestMeta18(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router26.get(
  "/",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const query = listInvoicesQuerySchema.parse(req.query);
    const { rows, total } = await invoiceService.listInvoices(
      req.user.organizationId,
      {
        search: query.search,
        status: query.status,
        clientId: query.clientId,
        contractId: query.contractId,
        subscriptionId: query.subscriptionId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo
      },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router26.get(
  "/:id",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await invoiceService.getInvoice(req.user.organizationId, req.params.id);
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/",
  requirePermission("invoices.create"),
  asyncHandler(async (req, res) => {
    const input = createInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.createInvoice(req.user, input, requestMeta18(req));
    sendSuccess(res, { invoice }, 201);
  })
);
router26.patch(
  "/:id",
  requirePermission("invoices.update"),
  asyncHandler(async (req, res) => {
    const input = updateInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.updateInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/:id/issue",
  requirePermission("invoices.issue"),
  asyncHandler(async (req, res) => {
    const input = issueInvoiceSchema.parse(req.body ?? {});
    const invoice = await invoiceService.issueInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/:id/void",
  requirePermission("invoices.void"),
  asyncHandler(async (req, res) => {
    const input = voidInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.voidInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.get(
  "/:id/payments",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const { rows, total } = await paymentService.listPayments(req.user.organizationId, { invoiceId: req.params.id }, 1, 100, "paymentDate", "asc");
    sendSuccess(res, { payments: rows }, 200, { page: 1, limit: 100, total });
  })
);
router26.post(
  "/:id/payments",
  requirePermission("payments.create"),
  asyncHandler(async (req, res) => {
    const input = recordPaymentSchema.parse(req.body);
    const payment = await invoiceService.recordPayment(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { payment }, 201);
  })
);
var invoiceRoutes_default = router26;

// server/routes/v1/paymentRoutes.ts
import { Router as Router27 } from "express";

// server/schemas/paymentSchemas.ts
import { z as z24 } from "zod";
var SORT_FIELDS7 = ["paymentDate", "amount", "status", "createdAt"];
var listPaymentsQuerySchema = z24.object({
  ...paginationQuerySchema(SORT_FIELDS7, "paymentDate"),
  status: paymentStatusSchema.optional(),
  method: paymentMethodSchema.optional(),
  invoiceId: z24.string().trim().uuid().optional(),
  clientId: z24.string().trim().uuid().optional(),
  dateFrom: z24.coerce.date().optional(),
  dateTo: z24.coerce.date().optional()
});
var reversePaymentSchema = z24.object({
  reason: z24.string().trim().min(1).max(1e3)
});

// server/routes/v1/paymentRoutes.ts
var router27 = Router27();
router27.use(authenticateToken);
function requestMeta19(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router27.get(
  "/",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const query = listPaymentsQuerySchema.parse(req.query);
    const { rows, total } = await paymentService.listPayments(
      req.user.organizationId,
      { status: query.status, method: query.method, invoiceId: query.invoiceId, clientId: query.clientId, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router27.get(
  "/:id",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const payment = await paymentService.getPayment(req.user.organizationId, req.params.id);
    sendSuccess(res, { payment });
  })
);
router27.post(
  "/:id/reverse",
  requirePermission("payments.reverse"),
  asyncHandler(async (req, res) => {
    const input = reversePaymentSchema.parse(req.body);
    const payment = await paymentService.reversePayment(req.user, req.params.id, input, requestMeta19(req));
    sendSuccess(res, { payment });
  })
);
var paymentRoutes_default = router27;

// server/routes/v1/portalRoutes.ts
import { Router as Router28 } from "express";
import { z as z25 } from "zod";

// server/services/clientPortalService.ts
async function resolveClientForCaller(caller) {
  const client3 = await clientRepository.findByWorkspaceOrganizationId(caller.organizationId);
  if (!client3) throw new AuthorizationError("No client portal is associated with the current organization.");
  return client3;
}
var clientPortalService = {
  async getDashboard(caller) {
    const client3 = await resolveClientForCaller(caller);
    const [contracts, subscriptions, invoices, recentPayments] = await Promise.all([
      contractRepository.listForClientInOrg(client3.id, client3.organizationId),
      subscriptionRepository.listForClientInOrg(client3.id, client3.organizationId),
      invoiceRepository.listForClientInOrg(client3.id, client3.organizationId),
      paymentRepository.list(client3.organizationId, { clientId: client3.id }, 1, 5, "paymentDate", "desc")
    ]);
    const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
    const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE");
    const outstandingInvoices = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
    return {
      activeContractCount: activeContracts.length,
      activeSubscriptionCount: activeSubscriptions.length,
      outstandingInvoiceCount: outstandingInvoices.length,
      amountDue: sumMoney(outstandingInvoices.map((i) => i.amountDue)),
      currency: invoices[0]?.currency ?? subscriptions[0]?.currency ?? contracts[0]?.currency,
      recentPayments: recentPayments.rows
    };
  },
  async listContracts(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    const { rows, total } = await contractRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "createdAt", "desc");
    return { rows: rows.map((c) => ({ ...c, currentValue: calculateContractCurrentValue(c.contractValue, c.variations.map((v) => v.amount)) })), total };
  },
  async getContract(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const contract = await contractRepository.findByIdInOrg(id, client3.organizationId);
    if (!contract || contract.clientId !== client3.id) throw new NotFoundError("Contract not found.");
    return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
  },
  async listSubscriptions(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    return subscriptionRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "createdAt", "desc");
  },
  async getSubscription(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const subscription = await subscriptionRepository.findByIdInOrg(id, client3.organizationId);
    if (!subscription || subscription.clientId !== client3.id) throw new NotFoundError("Subscription not found.");
    return subscription;
  },
  async listInvoices(caller, page, limit, status) {
    const client3 = await resolveClientForCaller(caller);
    const { rows, total } = await invoiceRepository.list(client3.organizationId, { clientId: client3.id, status }, page, limit, "issueDate", "desc");
    return { rows: rows.map((i) => ({ ...i, effectiveStatus: effectiveInvoiceStatus(i) })), total };
  },
  async getInvoice(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const invoice = await invoiceRepository.findByIdInOrg(id, client3.organizationId);
    if (!invoice || invoice.clientId !== client3.id) throw new NotFoundError("Invoice not found.");
    return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
  },
  async listPayments(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    return paymentRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "paymentDate", "desc");
  }
};

// server/routes/v1/portalRoutes.ts
var router28 = Router28();
router28.use(authenticateToken);
var pageQuerySchema = z25.object({
  page: z25.coerce.number().int().positive().default(1),
  limit: z25.coerce.number().int().positive().max(100).default(20)
});
router28.get(
  "/dashboard",
  requirePermission("portal.dashboard.read"),
  asyncHandler(async (req, res) => {
    const dashboard = await clientPortalService.getDashboard(req.user);
    sendSuccess(res, { dashboard });
  })
);
router28.get(
  "/contracts",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listContracts(req.user, query.page, query.limit);
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/contracts/:id",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await clientPortalService.getContract(req.user, req.params.id);
    sendSuccess(res, { contract });
  })
);
router28.get(
  "/subscriptions",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listSubscriptions(req.user, query.page, query.limit);
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/subscriptions/:id",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await clientPortalService.getSubscription(req.user, req.params.id);
    sendSuccess(res, { subscription });
  })
);
router28.get(
  "/invoices",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.extend({ status: invoiceStatusSchema.optional() }).parse(req.query);
    const { rows, total } = await clientPortalService.listInvoices(req.user, query.page, query.limit, query.status);
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/invoices/:id",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await clientPortalService.getInvoice(req.user, req.params.id);
    sendSuccess(res, { invoice });
  })
);
router28.get(
  "/payments",
  requirePermission("portal.payments.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listPayments(req.user, query.page, query.limit);
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
var portalRoutes_default = router28;

// server/routes/v1/publicRoutes.ts
import { Router as Router29 } from "express";

// server/services/publicSiteService.ts
async function projectPublicMedia(media) {
  if (!media || media.status !== "ACTIVE" || media.visibility !== "PUBLIC") return null;
  const provider = getStorageProvider();
  const url = await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaSignedUrlTtlSeconds });
  return { url, altText: media.altText, caption: media.caption, width: media.width, height: media.height };
}
function hasPublicWebsiteOrganization() {
  return config.publicWebsiteOrganizationId.length > 0;
}
async function projectPage(page) {
  const revision = page.currentRevision;
  return {
    slug: page.slug,
    title: page.title,
    body: revision?.body ?? "",
    seo: revision?.metadata ?? {},
    featuredMedia: await projectPublicMedia(page.featuredMedia),
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt
  };
}
function projectAuthor(author) {
  if (!author) return null;
  return { name: `${author.user.firstName} ${author.user.lastName}`.trim(), bio: author.bio, avatarUrl: author.avatarUrl };
}
async function projectPost(post) {
  const revision = post.currentRevision;
  return {
    slug: post.slug,
    title: post.title,
    body: revision?.body ?? "",
    seo: revision?.metadata ?? {},
    category: post.category ? { slug: post.category.slug, name: post.category.name } : null,
    tags: post.tags.map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
    author: projectAuthor(post.author),
    featuredMedia: await projectPublicMedia(post.featuredMedia),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt
  };
}
var publicSiteService = {
  isConfigured: hasPublicWebsiteOrganization,
  async getPageBySlug(slug) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Page not found.");
    const page = await pageRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!page) throw new NotFoundError("Page not found.");
    return projectPage(page);
  },
  async listPosts(filters, page, limit, sort, order) {
    if (!hasPublicWebsiteOrganization()) return { rows: [], total: 0 };
    const organizationId = config.publicWebsiteOrganizationId;
    let categoryId;
    if (filters.categorySlug) {
      const category = await categoryRepository.findBySlugInOrg(organizationId, filters.categorySlug);
      if (!category) return { rows: [], total: 0 };
      categoryId = category.id;
    }
    let tagId;
    if (filters.tagSlug) {
      const tag = await tagRepository.findBySlugInOrg(organizationId, filters.tagSlug);
      if (!tag) return { rows: [], total: 0 };
      tagId = tag.id;
    }
    const { rows, total } = await postRepository.listPublished(organizationId, { search: filters.search, categoryId, tagId }, page, limit, sort, order);
    return { rows: await Promise.all(rows.map(projectPost)), total };
  },
  async getPostBySlug(slug) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Post not found.");
    const post = await postRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!post) throw new NotFoundError("Post not found.");
    return projectPost(post);
  },
  async listCategories() {
    if (!hasPublicWebsiteOrganization()) return [];
    const categories = await categoryRepository.list(config.publicWebsiteOrganizationId);
    return categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  },
  async listTags() {
    if (!hasPublicWebsiteOrganization()) return [];
    const tags = await tagRepository.list(config.publicWebsiteOrganizationId);
    return tags.map((t) => ({ slug: t.slug, name: t.name }));
  }
};

// server/services/publicProductService.ts
function projectProduct(product) {
  return {
    slug: product.slug,
    code: product.code,
    name: product.name,
    type: product.type,
    shortDescription: product.shortDescription,
    description: product.description,
    isFeatured: product.isFeatured,
    displayOrder: product.displayOrder
  };
}
function projectModule(module_) {
  return {
    slug: module_.slug,
    code: module_.code,
    name: module_.name,
    description: module_.description,
    isCore: module_.isCore,
    displayOrder: module_.displayOrder
  };
}
var publicProductService = {
  async listProducts(filters, page, limit) {
    const { rows, total } = await productRepository.list({ ...filters, status: "ACTIVE" }, page, limit, "displayOrder", "asc");
    return { rows: rows.map(projectProduct), total };
  },
  async getProductBySlug(slug) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    return projectProduct(product);
  },
  async getProductModules(slug) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    const { rows } = await productModuleRepository.listForProduct(product.id, "ACTIVE", 1, 100);
    return rows.map(projectModule);
  }
};

// server/services/publicLeadService.ts
function buildNotes(input) {
  const lines = [];
  if (input.subject) lines.push(`Subject: ${input.subject}`);
  if (input.productInterest) lines.push(`Product/service interest: ${input.productInterest}`);
  lines.push("", input.message.trim(), "", `Consent to be contacted: given (${input.source}).`);
  return lines.join("\n");
}
var publicLeadService = {
  /**
   * A non-empty `website` field (the honeypot — §8) means the caller is
   * almost certainly a bot: real visitors never see or fill it (hidden via
   * CSS). Returns `null` in that case — accepted-but-discarded, exactly
   * like a real submission from the caller's point of view, so a bot
   * learns nothing about which field gave it away.
   */
  async createLead(input, meta = {}) {
    if (input.website) {
      return null;
    }
    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) {
      throw new InfrastructureError("Public lead intake is not configured.");
    }
    const lead = await leadRepository.create({
      organizationId,
      companyName: input.company || input.name,
      contactName: input.name,
      email: input.email,
      phone: input.phone,
      source: `website:${input.source}`,
      notes: buildNotes(input)
    });
    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      actorName: "Public Website",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, source: lead.source },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return lead;
  }
};

// server/schemas/publicSchemas.ts
import { z as z26 } from "zod";
var SORT_FIELDS8 = ["publishedAt", "createdAt", "title"];
var listPublicPostsQuerySchema = z26.object({
  page: z26.coerce.number().int().positive().default(1),
  limit: z26.coerce.number().int().positive().max(50).default(12),
  search: z26.string().trim().max(200).optional(),
  category: z26.string().trim().max(150).optional(),
  tag: z26.string().trim().max(150).optional(),
  sort: z26.enum(SORT_FIELDS8).default("publishedAt"),
  order: z26.enum(["asc", "desc"]).default("desc")
});
var listPublicProductsQuerySchema = z26.object({
  page: z26.coerce.number().int().positive().default(1),
  limit: z26.coerce.number().int().positive().max(50).default(20),
  search: z26.string().trim().max(200).optional(),
  type: z26.enum(["PRODUCT", "SERVICE"]).optional()
});
var nonEmptyTrimmed = (max) => z26.string().trim().min(1).max(max);
var createPublicLeadSchema = z26.object({
  name: nonEmptyTrimmed(200),
  company: z26.string().trim().max(200).optional(),
  email: z26.string().trim().email().max(320),
  phone: z26.string().trim().max(50).optional(),
  subject: z26.string().trim().max(200).optional(),
  message: nonEmptyTrimmed(5e3),
  productInterest: z26.string().trim().max(200).optional(),
  source: z26.enum(["contact_form", "product_inquiry", "project_brief", "other"]).default("contact_form"),
  consent: z26.literal(true, { errorMap: () => ({ message: "Consent is required to submit this form." }) }),
  website: z26.string().trim().max(200).optional()
});

// server/routes/v1/publicRoutes.ts
var router29 = Router29();
function requestMeta20(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router29.get(
  "/site",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { configured: publicSiteService.isConfigured() });
  })
);
router29.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const page = await publicSiteService.getPageBySlug(req.params.slug);
    sendSuccess(res, { page });
  })
);
router29.get(
  "/posts",
  asyncHandler(async (req, res) => {
    const query = listPublicPostsQuerySchema.parse(req.query);
    const { rows, total } = await publicSiteService.listPosts(
      { search: query.search, categorySlug: query.category, tagSlug: query.tag },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router29.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = await publicSiteService.getPostBySlug(req.params.slug);
    sendSuccess(res, { post });
  })
);
router29.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await publicSiteService.listCategories();
    sendSuccess(res, { categories });
  })
);
router29.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await publicSiteService.listTags();
    sendSuccess(res, { tags });
  })
);
router29.get(
  "/products",
  asyncHandler(async (req, res) => {
    const query = listPublicProductsQuerySchema.parse(req.query);
    const { rows, total } = await publicProductService.listProducts({ search: query.search, type: query.type }, query.page, query.limit);
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router29.get(
  "/products/:slug",
  asyncHandler(async (req, res) => {
    const product = await publicProductService.getProductBySlug(req.params.slug);
    sendSuccess(res, { product });
  })
);
router29.get(
  "/products/:slug/modules",
  asyncHandler(async (req, res) => {
    const modules = await publicProductService.getProductModules(req.params.slug);
    sendSuccess(res, { modules });
  })
);
router29.post(
  "/leads",
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
    const input = createPublicLeadSchema.parse(req.body);
    await publicLeadService.createLead(input, requestMeta20(req));
    sendSuccess(res, { message: "Thank you \u2014 your message has been received. We'll be in touch shortly." }, 201);
  })
);
var publicRoutes_default = router29;

// server/routes/v1/index.ts
var v1Router = Router30();
v1Router.use("/auth", authRoutes_default);
v1Router.use("/webhooks", webhookRoutes_default);
v1Router.use("/system", systemRoutes_default);
v1Router.use("/users", userRoutes_default);
v1Router.use("/roles", roleRoutes_default);
v1Router.use("/permissions", permissionsRouter);
v1Router.use("/organizations", organizationRoutes_default);
v1Router.use("/audit-logs", auditLogRoutes_default);
v1Router.use("/settings", settingsRoutes_default);
v1Router.use("/leads", leadRoutes_default);
v1Router.use("/clients", clientRoutes_default);
v1Router.use("/contacts", contactRoutes_default);
v1Router.use("/crm", crmRoutes_default);
v1Router.use("/onboarding", onboardingRoutes_default);
v1Router.use("/workspaces", workspaceRoutes_default);
v1Router.use("/invitations", invitationRoutes_default);
v1Router.use("/products", productRoutes_default);
v1Router.use("/product-modules", productModuleRoutes_default);
v1Router.use("/pages", pageRoutes_default);
v1Router.use("/posts", postRoutes_default);
v1Router.use("/categories", categoryRoutes_default);
v1Router.use("/tags", tagRoutes_default);
v1Router.use("/authors", authorRoutes_default);
v1Router.use("/media", mediaRoutes_default);
v1Router.use("/contracts", contractRoutes_default);
v1Router.use("/subscriptions", subscriptionRoutes_default);
v1Router.use("/invoices", invoiceRoutes_default);
v1Router.use("/payments", paymentRoutes_default);
v1Router.use("/portal", portalRoutes_default);
v1Router.use("/public", publicRoutes_default);
var v1_default = v1Router;

// server/app/app.ts
function createApp() {
  const app2 = express3();
  app2.use(requestIdMiddleware);
  applySecurityMiddleware(app2);
  app2.use(requestLogger);
  app2.use("/api", generalApiLimiter);
  app2.use("/api/v1", v1_default);
  return app2;
}
function finalizeApp(app2) {
  app2.use("/api", notFoundHandler);
  app2.use(errorHandlerMiddleware);
}

// server/vercelHandler.ts
var app = createApp();
finalizeApp(app);
var vercelHandler_default = app;
export {
  vercelHandler_default as default
};
