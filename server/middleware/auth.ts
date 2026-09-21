/**
 * Authentication/authorization middleware. Ported from the Phase 0 audit's
 * artifysolscom/server/services/authService.ts middleware chain
 * (docs/AUTHORIZATION_MODEL.md §2 — REUSE, this design was sound), backed
 * by real Postgres sessions (Phase 1) and, as of Phase 2, real database
 * roles/permissions resolved via role_permissions
 * (docs/ADR/ADR-011-permission-based-rbac-schema.md) instead of a flat
 * per-user array.
 *
 * Important scope note (docs/AUTHORIZATION_MODEL.md §3.1): these functions
 * confirm a caller is authenticated and holds a permission/role. They do
 * NOT by themselves confirm the caller owns the specific record being
 * acted on — every route that mutates a single resource by ID must
 * additionally call `enforceTenantIsolation` (or an equivalent per-record
 * ownership check) once the record's organizationId is known.
 */
import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/authService";
import { AuthenticationError, AuthorizationError, TenantIsolationError } from "../core/errors";
import type { PermissionKey, RoleKey } from "../types/domain";
import { asyncHandler } from "../utils/asyncHandler";

const SUPER_ADMIN_ROLE_KEY: RoleKey = "SUPER_ADMIN";

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return undefined;
}

export const authenticateToken = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError("Authentication token is required.");
  }

  const user = await authService.verifySession(token);
  if (!user) {
    throw new AuthenticationError("Invalid or expired session token.");
  }

  req.user = user;
  req.sessionToken = token;
  req.organizationId = user.organizationId;
  next();
});

export const optionalAuthenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req);
  if (token) {
    const user = await authService.verifySession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      req.organizationId = user.organizationId;
    }
  }
  next();
});

export function requirePermission(permission: PermissionKey) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY) return next();
    if (!req.user.role.permissions.includes(permission)) {
      throw new AuthorizationError(`Permission denied. Required privilege: "${permission}"`);
    }
    next();
  };
}

export function requireRole(allowedRoleKeys: RoleKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY || allowedRoleKeys.includes(req.user.role.key as RoleKey)) {
      return next();
    }
    throw new AuthorizationError(`Forbidden. Requires one of: ${allowedRoleKeys.join(", ")}`);
  };
}

/**
 * Rejects a request whose target organizationId (param/query/body) doesn't
 * match the caller's own — the tenant-boundary check every single-record
 * route must apply (see the module doc comment above).
 */
export function enforceTenantIsolation(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new AuthenticationError();
  if (req.user.role.key === SUPER_ADMIN_ROLE_KEY) return next();

  const requested =
    (req.params.organizationId as string | undefined) ??
    (req.query.organizationId as string | undefined) ??
    (req.body as Record<string, unknown> | undefined)?.organizationId;

  if (typeof requested === "string" && requested !== req.user.organizationId) {
    throw new TenantIsolationError();
  }
  next();
}

/**
 * Generic per-record ownership guard: loads a record's organizationId via
 * `loadOrganizationId` and rejects the request if it doesn't match the
 * caller's tenant. Use this on every route that takes a resource :id, once
 * real business routes exist (Phase 4+) — this is the concrete fix for the
 * horizontal-privilege-escalation gap documented in
 * docs/AUTHORIZATION_MODEL.md §3.1.
 */
export function enforceRecordOwnership(loadOrganizationId: (req: Request) => Promise<string | null>) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY) return next();

    const recordOrganizationId = await loadOrganizationId(req);
    if (recordOrganizationId === null) return next(); // route's own NotFoundError should fire next
    if (recordOrganizationId !== req.user.organizationId) {
      throw new TenantIsolationError();
    }
    next();
  });
}
