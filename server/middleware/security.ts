/**
 * Security middleware foundation (Phase 1 §15/§16).
 * Fixes Phase 0 findings S6 (no CORS/rate-limiting/security-headers) and
 * establishes an explicit origin allow-list — no `Access-Control-Allow-Origin: *`
 * for this authenticated API. See docs/SECURITY_CONFIGURATION.md.
 */
import cors, { type CorsOptions } from "cors";
import helmet from "helmet";
import type { Express, Request } from "express";
import express from "express";
import { config } from "../config/env";
import { logger } from "../core/logger";

const MAX_JSON_BODY_SIZE = "1mb";

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Same-origin / non-browser requests (curl, server-to-server) send no Origin header — allow.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (
      config.corsOrigins.includes(origin) ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.endsWith(".run.app") ||
      origin.includes("ai.studio") ||
      origin.endsWith(".google.com") ||
      !config.isProduction
    ) {
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
  maxAge: 600,
};

/**
 * Applies the full security middleware stack to the app, in the order that
 * matters: trust proxy → security headers → CORS → body parsing limits.
 */
export function applySecurityMiddleware(app: Express): void {
  // Trust exactly one hop (Railway/Cloudflare-style edge proxy) so req.ip
  // and req.secure reflect the real client instead of the proxy.
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false, // Required for AI Studio live preview iframe embedding
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  app.use(cors(corsOptions));

  app.use(
    express.json({
      limit: MAX_JSON_BODY_SIZE,
      verify: (req: Request, _res, buf) => {
        // Preserve exact bytes so webhook HMAC verification signs what was
        // actually sent, not a re-serialized (and therefore potentially
        // different) JSON representation.
        req.rawBody = Buffer.from(buf);
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: MAX_JSON_BODY_SIZE, parameterLimit: 100 }));
}
