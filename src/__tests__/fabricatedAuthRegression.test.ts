/**
 * Phase 4 §33/§34 — explicit regression proof that no fabricated
 * authentication/privilege-escalation surface exists anywhere in the
 * shipped frontend source. Re-run this and it fails loudly the moment any
 * of these patterns is reintroduced, by any future change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..");

const FORBIDDEN_PATTERNS: RegExp[] = [
  /switchUserRole/i,
  /loginAsDemo/i,
  /demo\s*super\s*admin/i,
  /login\s+as\s+admin/i,
  /1-click.*demo/i,
  /auto-?fill demo/i,
  /localStorage\.(role|isAdmin|userRole)\b/i,
  /mock\s*auth/i,
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("fabricated-auth regression (Phase 4 §34)", () => {
  const files = walk(SRC_ROOT);

  it("scanned at least the expected number of source files (sanity check the scan itself isn't vacuous)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`no source file matches forbidden pattern: ${pattern}`, () => {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf-8")));
      expect(offenders).toEqual([]);
    });
  }
});
