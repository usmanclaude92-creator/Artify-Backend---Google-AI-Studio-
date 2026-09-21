/**
 * Express Request augmentation. Single source of truth for every custom
 * field attached to `req` across the middleware chain — requestId
 * (server/middleware/requestId.ts), rawBody (server/middleware/security.ts,
 * needed for webhook HMAC verification), and the authenticated-request
 * context (server/middleware/auth.ts).
 */
import type { SanitizedUser } from "./domain";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      rawBody?: Buffer;
      user?: SanitizedUser;
      sessionToken?: string;
      organizationId?: string;
    }
  }
}

export {};
