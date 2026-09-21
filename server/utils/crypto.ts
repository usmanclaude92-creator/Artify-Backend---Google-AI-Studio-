/**
 * Crypto primitives: session token generation and HMAC signing/verification
 * for webhooks. Constant-time comparison throughout — Phase 0 finding S3/R3
 * (the old webhook check used `!==` string comparison and, worse, defaulted
 * to "verified" when the header was simply absent) must not recur anywhere
 * that compares a secret-derived value.
 */
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";

export function generateSessionToken(): string {
  return `art_sess_${randomBytes(32).toString("hex")}`;
}

/** Same entropy/shape family as generateSessionToken, distinct prefix so a
 * reset credential can never be confused with (or accidentally accepted
 * as) a session token by a caller that forgets which endpoint it's for. */
export function generateResetToken(): string {
  return `art_reset_${randomBytes(32).toString("hex")}`;
}

/**
 * Hashes a session token for at-rest storage (Phase 2 §18). Deliberately a
 * plain, fast SHA-256 — the input is already a 256-bit cryptographically
 * random value (from generateSessionToken above), not a low-entropy secret
 * like a password, so there is nothing for a fast hash to make
 * brute-forceable. This is the same reasoning GitHub/Auth0 apply to API
 * token storage; do not reuse this function for passwords — see
 * server/utils/password.ts for that.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Same entropy/shape family as generateSessionToken/generateResetToken, distinct prefix (Phase 6 §18) — a client-admin invitation token must never be confused with a session or password-reset credential. */
export function generateInvitationToken(): string {
  return `art_invite_${randomBytes(32).toString("hex")}`;
}

/** Same entropy/shape family as the other bearer tokens above (Phase 9 §14) — a media upload-session secret must never be confused with a session/reset/invitation credential. Hashed at rest with `hashToken`, same as the others. */
export function generateUploadToken(): string {
  return `art_upload_${randomBytes(32).toString("hex")}`;
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function signHmac(secret: string, payload: Buffer | string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time HMAC signature comparison. Returns false (never throws) for
 * any malformed input — a malformed signature must be treated the same as
 * a wrong one, not as a special "skip verification" case.
 */
export function verifyHmacSignature(secret: string, payload: Buffer | string, providedSignatureHex: string): boolean {
  if (!providedSignatureHex || typeof providedSignatureHex !== "string") return false;

  const expected = signHmac(secret, payload);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignatureHex, "hex");

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
