import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../server/utils/password";

describe("password hashing", () => {
  it("hashes a password and verifies the correct password against it", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple123");
    expect(await verifyPassword("CorrectHorseBatteryStaple123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple123");
    expect(await verifyPassword("WrongPassword", hash)).toBe(false);
  });

  it("never stores the password in plaintext (hash differs from input)", async () => {
    const hash = await hashPassword("CorrectHorseBatteryStaple123");
    expect(hash).not.toBe("CorrectHorseBatteryStaple123");
    expect(hash).not.toContain("CorrectHorseBatteryStaple123");
  });

  it("produces a different hash each time for the same password (salted)", async () => {
    const hash1 = await hashPassword("SamePassword123");
    const hash2 = await hashPassword("SamePassword123");
    expect(hash1).not.toBe(hash2);
    // ...but both still verify correctly, proving the salt is embedded in the hash.
    expect(await verifyPassword("SamePassword123", hash1)).toBe(true);
    expect(await verifyPassword("SamePassword123", hash2)).toBe(true);
  });

  it("is not the Phase 0 vulnerable scheme (unsalted SHA-256 is deterministic; bcrypt output is not raw hex-64)", async () => {
    const hash = await hashPassword("AnyPassword123");
    // Unsalted SHA-256 hex digest is exactly 64 lowercase-hex characters.
    // bcrypt output is a $2*$-prefixed 60-char string — structurally different.
    expect(hash.startsWith("$2")).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(false);
  });
});
