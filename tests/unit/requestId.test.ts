import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requestIdMiddleware } from "../../server/middleware/requestId";

function mockReqRes(incomingId?: string) {
  const headers: Record<string, string> = {};
  if (incomingId !== undefined) headers["x-request-id"] = incomingId;

  const req = { headers } as unknown as Request;
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next = vi.fn();

  return { req, res, next, setHeader };
}

describe("requestIdMiddleware", () => {
  it("generates a request id when none is provided", () => {
    const { req, res, next, setHeader } = mockReqRes();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBeTruthy();
    expect(setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts a safe incoming request id and echoes it back", () => {
    const { req, res, next } = mockReqRes("client-trace-abc123");
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBe("client-trace-abc123");
  });

  it("rejects an unsafe incoming request id (e.g. containing a header-injection newline) and generates one instead", () => {
    const { req, res, next } = mockReqRes("abc\r\nX-Evil: 1");
    requestIdMiddleware(req, res, next);
    expect(req.requestId).not.toBe("abc\r\nX-Evil: 1");
    expect(req.requestId).toBeTruthy();
  });

  it("rejects an overly long incoming request id", () => {
    const { req, res, next } = mockReqRes("a".repeat(500));
    requestIdMiddleware(req, res, next);
    expect(req.requestId?.length).toBeLessThan(500);
  });
});
