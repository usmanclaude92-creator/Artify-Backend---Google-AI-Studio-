/**
 * Rate limiting foundation (Phase 1 §15, fixes part of S6). Two profiles:
 * a general API limiter and a strict one for auth endpoints (brute-force /
 * credential-stuffing protection — docs/SECURITY_MODEL.md target
 * architecture, "Authentication" section).
 *
 * In-memory store is fine for Phase 1 (single instance). Multi-instance
 * deployment (Phase 16) should move to a shared store (e.g. Redis) so
 * limits are enforced across all instances — tracked in
 * docs/PRODUCTION_READINESS_CHECKLIST.md, not blocking Phase 1.
 */
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { sendError, ApiErrorCode } from "../core/apiResponse";

function rateLimitHandler(req: Request, res: Response): void {
  sendError(res, 429, ApiErrorCode.RATE_LIMIT_EXCEEDED, "Too many requests. Please try again later.");
}

export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Applied to /auth/login and /auth/register only. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Key by IP + attempted email so one IP can't lock out unrelated accounts,
  // while still throttling both credential stuffing and single-account brute force.
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  },
});

export const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/** Password-reset request/confirm — prevents token-guessing and reset-spam against a single account, keyed the same way as authLimiter. */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  },
});

/** Public website lead intake (Phase 11 §8) — anonymous, so keyed by IP only; tight enough to blunt spam/scraping without blocking a genuine visitor who submits more than once. */
export const publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => req.ip ?? "unknown-ip",
});

/** Authenticated sensitive actions (change-password, organization switch) — lower volume than general API traffic, keyed per-caller. */
export const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? "unknown",
});
