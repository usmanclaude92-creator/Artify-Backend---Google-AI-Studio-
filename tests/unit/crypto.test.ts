import { describe, expect, it } from "vitest";
import { verifyHmacSignature, signHmac, generateSessionToken, generateId } from "../../server/utils/crypto";

describe("HMAC signature verification", () => {
  const secret = "test-secret-value";
  const payload = Buffer.from("1234567890.some-request-body");

  it("verifies a correctly signed payload", () => {
    const sig = signHmac(secret, payload);
    expect(verifyHmacSignature(secret, payload, sig)).toBe(true);
  });

  it("rejects a tampered payload signed with the same secret for different bytes", () => {
    const sig = signHmac(secret, payload);
    const tampered = Buffer.from("1234567890.some-DIFFERENT-body");
    expect(verifyHmacSignature(secret, tampered, sig)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = signHmac(secret, payload);
    expect(verifyHmacSignature("wrong-secret", payload, sig)).toBe(false);
  });

  it("rejects an empty signature — this is the exact Phase 0 vulnerability fix (S3/R3: a missing header must never be treated as verified)", () => {
    expect(verifyHmacSignature(secret, payload, "")).toBe(false);
  });

  it("rejects a malformed (non-hex) signature without throwing", () => {
    expect(() => verifyHmacSignature(secret, payload, "not-a-hex-signature!!")).not.toThrow();
    expect(verifyHmacSignature(secret, payload, "not-a-hex-signature!!")).toBe(false);
  });

  it("rejects a signature of the wrong length rather than throwing on Buffer length mismatch", () => {
    expect(verifyHmacSignature(secret, payload, "ab")).toBe(false);
  });
});

describe("token/id generation", () => {
  it("generates unique session tokens with the expected prefix", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.startsWith("art_sess_")).toBe(true);
  });

  it("generates prefixed ids", () => {
    expect(generateId("usr").startsWith("usr_")).toBe(true);
  });
});
