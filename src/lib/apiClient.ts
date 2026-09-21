/**
 * Canonical Platform API client for the Control Center (Phase 1 §25, §14).
 *
 * This app now hosts the Platform API itself (server/routes/v1 — see
 * docs/ADR/ADR-001-platform-boundary.md), so the default base URL is
 * same-origin `/api/v1`. Centralizes headers, credentials, timeout, and
 * response-envelope parsing so components never call `fetch` directly.
 *
 * Scope note: this is the abstraction only. AdminDataContext.tsx is not
 * rewired to use it in Phase 1 — that cutover (module by module, starting
 * with Users/Roles/Leads/Audit Logs) is Phase 4, per
 * docs/IMPLEMENTATION_PLAN.md.
 */

const DEFAULT_BASE_URL = "/api/v1";
const DEFAULT_TIMEOUT_MS = 15000;

function resolveBaseUrl(): string {
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_PLATFORM_API_BASE_URL;
  return configured && configured.length > 0 ? configured : DEFAULT_BASE_URL;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta: { requestId: string; timestamp: string; pagination?: unknown };
}

export interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown; requestId: string };
  meta: { requestId: string; timestamp: string };
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId: string | undefined;
  public readonly details: unknown;

  constructor(message: string, opts: { code: string; status: number; requestId?: string; details?: unknown }) {
    super(message);
    this.name = "ApiClientError";
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.details = opts.details;
  }
}

/** Injected by AuthContext (Phase 4) so every request carries the current bearer token without each component threading it through. */
let authTokenGetter: (() => string | null) | null = null;
export function setAuthTokenGetter(getter: (() => string | null) | null): void {
  authTokenGetter = getter;
}

/**
 * Injected by AuthContext — called once, centrally, whenever any request
 * comes back 401 (Phase 4 §25/§26: "one authoritative frontend
 * authentication state," never a per-component ad-hoc redirect). Clears
 * auth state and returns the user to login. Not invoked for 401s from the
 * login/register endpoints themselves (a failed login is not a session
 * expiry) — callers pass `suppressUnauthorizedHandling` for those.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Skip the global 401 → clear-auth-state handler (e.g. the login form's own failed-attempt 401). */
  suppressUnauthorizedHandling?: boolean;
}

async function apiRequestEnvelope<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiSuccessEnvelope<T>> {
  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = authTokenGetter?.();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  options.signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiClientError("Request timed out.", { code: "TIMEOUT", status: 0 });
    }
    throw new ApiClientError("Network error contacting the Artify Platform API.", { code: "NETWORK_ERROR", status: 0 });
  }
  clearTimeout(timeout);

  const requestId = response.headers.get("X-Request-Id") ?? undefined;

  let payload: ApiSuccessEnvelope<T> | ApiErrorEnvelope | undefined;
  try {
    payload = (await response.json()) as ApiSuccessEnvelope<T> | ApiErrorEnvelope;
  } catch {
    payload = undefined;
  }

  if (!response.ok || !payload || payload.success === false) {
    const errorPayload = payload && payload.success === false ? payload.error : undefined;
    if (response.status === 401 && !options.suppressUnauthorizedHandling) {
      unauthorizedHandler?.();
    }
    throw new ApiClientError(errorPayload?.message ?? `Request failed with status ${response.status}`, {
      code: errorPayload?.code ?? "UNKNOWN_ERROR",
      status: response.status,
      requestId: errorPayload?.requestId ?? requestId,
      details: errorPayload?.details,
    });
  }

  return payload;
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const envelope = await apiRequestEnvelope<T>(path, options);
  return envelope.data;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "GET" }),
  /** Returns the full envelope (incl. `meta.pagination`) — used by list endpoints; everything else uses the plain data-only helpers below. */
  getRaw: <T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequestEnvelope<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: Omit<ApiRequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...options, method: "DELETE" }),
};
