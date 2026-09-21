/**
 * Wraps an async Express route handler so a rejected promise is forwarded
 * to `next(err)` instead of crashing the process or hanging the request.
 * This app pins Express 4 (no automatic async-error capture), so every
 * async route handler must be wrapped with this.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
