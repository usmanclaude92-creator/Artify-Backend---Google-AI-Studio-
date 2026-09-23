/**
 * Centralized error handling (Phase 1 §12). Every route's errors funnel
 * here via server/utils/asyncHandler.ts or Express's default async-error
 * capture (Express 5) — this app pins Express 4, so routes must use
 * asyncHandler. Production responses never leak stack traces, SQL, file
 * paths, or secret values (Phase 0 finding: none currently leaks, but no
 * handler existed to guarantee it going forward — this is that guarantee).
 */
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiErrorCode, sendError } from "../core/apiResponse";
import { AppError, InternalError, isAppError, ValidationError } from "../core/errors";
import { logger } from "../core/logger";

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, ApiErrorCode.RESOURCE_NOT_FOUND, `No route matches ${req.method} ${req.path}`);
}

export function errorHandlerMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? "unknown-request-id";
  const log = logger.child({ requestId, route: req.path, method: req.method });

  let appError: AppError;

  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new ValidationError("Request validation failed", err.flatten());
  } else {
    // Unknown/unexpected error — log full detail server-side, never client-side.
    appError = new InternalError("An unexpected error occurred");
    log.error({ err, event: "unhandled_error" }, "Unhandled error reached the error middleware");
  }

  if (appError.statusCode >= 500) {
    log.error({ err, event: "app_error" }, appError.message);
  } else {
    log.warn({ event: "app_error", code: appError.code, details: appError.details }, appError.message);
  }

  const exposeDetails = appError.statusCode < 500; // client-caused errors may echo validation details
  sendError(
    res,
    appError.statusCode,
    appError.code,
    appError.statusCode >= 500 ? "An unexpected error occurred" : appError.message,
    exposeDetails ? appError.details : undefined
  );
}
