/**
 * Password hashing. Fixes Phase 0 finding S5/R5: unsalted SHA-256
 * (`crypto.createHash('sha256')`) is never used for password storage in
 * this codebase. bcryptjs is used instead of native `bcrypt` to keep the
 * Phase 1 build dependency-free of a native-addon toolchain across every
 * deployment target (Railway/Vercel/local) — cost factor 12 keeps the
 * per-hash time in the same practical range as native bcrypt at this cost.
 */
import bcrypt from "bcryptjs";
import { config } from "../config/env";

const SALT_ROUNDS = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainTextPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, hash);
}

/**
 * A small, deliberately unremarkable set of the most common breached
 * passwords — not a substitute for a real breach-corpus API (out of scope
 * for Phase 3, no external dependency introduced), just enough to reject
 * the handful of values every credential-stuffing list tries first.
 */
const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein123",
  "admin1234",
  "welcome123",
  "changeme123",
]);

/**
 * Sensible minimum password policy (Phase 3 §5): minimum length (centralized
 * in config, not hard-coded per call site), not purely numeric, not one of
 * the small known-weak set above. Deliberately does not require a specific
 * mix of character classes — length-based policies are better-evidenced
 * (NIST 800-63B) than forced complexity rules that just push users toward
 * predictable substitutions.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (password.length < config.passwordMinLength) {
    return `Password must be at least ${config.passwordMinLength} characters.`;
  }
  if (/^\d+$/.test(password)) {
    return "Password must not be entirely numeric.";
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return "This password is too common. Choose a less predictable password.";
  }
  return null;
}
