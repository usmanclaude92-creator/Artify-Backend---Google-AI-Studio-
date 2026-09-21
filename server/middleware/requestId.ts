/**
 * Request correlation ID. Accepts an incoming X-Request-Id from a trusted
 * upstream proxy (Railway/Cloudflare — trust proxy is enabled in
 * server/middleware/security.ts) or generates one. Propagated onto the
 * response header, into every structured log line for the request
 * (server/middleware/requestLogger.ts), and into error responses
 * (server/core/apiResponse.ts) so a client-reported issue can be traced to
 * exact log lines. See docs/OBSERVABILITY.md.
 */
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";
const MAX_INCOMING_ID_LENGTH = 128;

function isSafeIncomingId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_INCOMING_ID_LENGTH && /^[A-Za-z0-9_.-]+$/.test(value);
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;

  const requestId = incomingValue && isSafeIncomingId(incomingValue) ? incomingValue : randomUUID();

  req.requestId = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
