/**
 * Express app assembly — the canonical Platform API surface. Frontend
 * static/dev-middleware serving is composed separately in the root
 * server.ts bootstrap, onto the same Express instance, matching the
 * existing single-process deployment topology (Railway/Docker) documented
 * in docs/TARGET_ARCHITECTURE.md.
 */
import express, { type Express } from "express";
import { requestIdMiddleware } from "../middleware/requestId";
import { applySecurityMiddleware } from "../middleware/security";
import { requestLogger } from "../middleware/requestLogger";
import { generalApiLimiter } from "../middleware/rateLimiter";
import { errorHandlerMiddleware, notFoundHandler } from "../middleware/errorHandler";
import v1Router from "../routes/v1";

/**
 * Builds the app through the API route mount only. The caller (root
 * server.ts) must add frontend static/dev-middleware serving *after*
 * calling this and *before* calling `finalizeApp` — Express error-handling
 * middleware only catches errors from handlers registered before it, so
 * the 404/error handlers have to be genuinely last in the stack, not just
 * last within this function.
 */
export function createApp(): Express {
  const app = express();

  // Order matters: request id first (everything downstream needs it),
  // then security headers/CORS/body-limits, then request logging (so log
  // lines carry the request id), then rate limiting, then routes.
  app.use(requestIdMiddleware);
  applySecurityMiddleware(app);
  app.use(requestLogger);
  app.use("/api", generalApiLimiter);

  app.use("/api/v1", v1Router);

  return app;
}

/** Mounts the 404 (API-only) and centralized error handler. Call this last, after frontend serving is mounted. */
export function finalizeApp(app: Express): void {
  app.use("/api", notFoundHandler);
  app.use(errorHandlerMiddleware);
}
