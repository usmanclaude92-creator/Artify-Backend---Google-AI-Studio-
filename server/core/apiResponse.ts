/**
 * Standardized API response envelope.
 * Ported from the Phase 0 artifysolscom/server/core/apiResponse.ts design
 * (docs/MIGRATION_PLAN.md — REUSE), unchanged in shape, ported into the
 * canonical platform. See docs/API_DESIGN.md §1.
 */
import type { Request, Response } from "express";

export enum ApiErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  RESOURCE_CONFLICT = "RESOURCE_CONFLICT",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  TENANT_ISOLATION_ERROR = "TENANT_ISOLATION_ERROR",
  AI_EXECUTION_ERROR = "AI_EXECUTION_ERROR",
  AI_APPROVAL_REQUIRED = "AI_APPROVAL_REQUIRED",
  INSUFFICIENT_QUOTA = "INSUFFICIENT_QUOTA",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
    requestId: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

function getRequestId(req: Request): string {
  const existing = req.headers["x-request-id"];
  return typeof existing === "string" && existing.length > 0 ? existing : "unknown-request-id";
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  pagination?: { page: number; limit: number; total: number }
): void {
  const requestId = getRequestId(res.req);

  const body: ApiSuccessBody<T> = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      pagination: pagination
        ? {
            page: pagination.page,
            limit: pagination.limit,
            total: pagination.total,
            totalPages: Math.max(1, Math.ceil(pagination.total / pagination.limit)),
          }
        : undefined,
    },
  };

  res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: ApiErrorCode | string,
  message: string,
  details?: unknown
): void {
  const requestId = getRequestId(res.req);

  const body: ApiErrorBody = {
    success: false,
    error: { code, message, details, requestId },
    meta: { requestId, timestamp: new Date().toISOString() },
  };

  res.status(statusCode).json(body);
}
