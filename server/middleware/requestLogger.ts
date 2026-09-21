/**
 * Structured per-request access logging via pino-http. Emits one log line
 * per request with requestId/route/method/statusCode/duration (Phase 1
 * §13/§14), replacing ad-hoc console.log in request paths.
 */
import pinoHttp from "pino-http";
import type { Request } from "express";
import { logger } from "../core/logger";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req: Request) => req.requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customProps: (req: Request) => ({
    actorId: req.user?.id,
    organizationId: req.organizationId,
  }),
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
