/**
 * Typed application error hierarchy. Every error a service throws should be
 * one of these (or a subclass), never a bare `Error` or a string. The
 * centralized error-handling middleware (server/middleware/errorHandler.ts)
 * maps each type to the correct HTTP status and ApiErrorCode and never
 * leaks internals for anything that isn't one of these. See
 * docs/API_DESIGN.md and docs/SECURITY_MODEL.md ("Production responses must
 * not leak stack traces...").
 */
import { ApiErrorCode } from "./apiResponse";

export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: ApiErrorCode;
  readonly details?: unknown;

  protected constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = ApiErrorCode.VALIDATION_ERROR;
  constructor(message = "Request validation failed", details?: unknown) {
    super(message, details);
  }
}

export class AuthenticationError extends AppError {
  readonly statusCode = 401;
  readonly code = ApiErrorCode.UNAUTHORIZED;
  constructor(message = "Authentication required") {
    super(message);
  }
}

export class AuthorizationError extends AppError {
  readonly statusCode = 403;
  readonly code = ApiErrorCode.FORBIDDEN;
  constructor(message = "Permission denied") {
    super(message);
  }
}

export class TenantIsolationError extends AppError {
  readonly statusCode = 403;
  readonly code = ApiErrorCode.TENANT_ISOLATION_ERROR;
  constructor(message = "Access denied: resource belongs to a different organization") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = ApiErrorCode.RESOURCE_NOT_FOUND;
  constructor(message = "Resource not found") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly code = ApiErrorCode.RESOURCE_CONFLICT;
  constructor(message = "Resource conflict", details?: unknown) {
    super(message, details);
  }
}

export class RateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = ApiErrorCode.RATE_LIMIT_EXCEEDED;
  constructor(message = "Too many requests") {
    super(message);
  }
}

export class NotImplementedError extends AppError {
  readonly statusCode = 501;
  readonly code = ApiErrorCode.NOT_IMPLEMENTED;
  constructor(message = "This feature is not implemented yet") {
    super(message);
  }
}

/** Infrastructure failures (DB unreachable, etc.) — message is safe for logs, never for clients. */
export class InfrastructureError extends AppError {
  readonly statusCode = 503;
  readonly code = ApiErrorCode.SERVICE_UNAVAILABLE;
  constructor(message = "A required infrastructure dependency is unavailable") {
    super(message);
  }
}

export class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = ApiErrorCode.INTERNAL_ERROR;
  constructor(message = "An unexpected error occurred") {
    super(message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
