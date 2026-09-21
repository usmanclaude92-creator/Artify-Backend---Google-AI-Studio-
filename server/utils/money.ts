/**
 * Decimal-safe financial primitives (Phase 10 — docs/BILLING_ARCHITECTURE.md).
 * Every authoritative monetary value in this codebase is a Prisma
 * `Decimal` (decimal.js under the hood) end to end — from the database
 * column (`NUMERIC(18,3)`, ADR-012) through every service calculation to
 * the API response. Native JS `number` arithmetic (float) never touches
 * an authoritative financial value; `toFixed()` is never used as a
 * rounding source of truth.
 *
 * Rounding policy: ROUND_HALF_UP to 3 decimal places (`MONEY_DECIMALS`),
 * matching OMR's minor-unit precision (baisa) and applied uniformly
 * regardless of the record's actual currency — see docs/BILLING_ARCHITECTURE.md
 * "Currency" for why a single global decimal policy is safe here (no
 * multi-currency arithmetic is ever performed — see `assertSameCurrency`).
 */
import { Prisma } from "@prisma/client";
import { ValidationError } from "../core/errors";

export const MONEY_DECIMALS = 3;
export const DEFAULT_CURRENCY = "OMR";

export type Money = Prisma.Decimal;

export function toMoney(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value);
}

export const ZERO: Money = toMoney(0);

/** Rounds to the platform's 3-decimal money precision using ROUND_HALF_UP — the one place this policy is applied, so it can never drift between call sites. */
export function roundMoney(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value).toDecimalPlaces(MONEY_DECIMALS, Prisma.Decimal.ROUND_HALF_UP);
}

export function addMoney(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): Money {
  return roundMoney(new Prisma.Decimal(a).plus(b));
}

export function subtractMoney(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): Money {
  return roundMoney(new Prisma.Decimal(a).minus(b));
}

export function sumMoney(values: Prisma.Decimal.Value[]): Money {
  return roundMoney(values.reduce((acc: Prisma.Decimal, v) => acc.plus(v), new Prisma.Decimal(0)));
}

export function multiplyMoney(unitPrice: Prisma.Decimal.Value, quantity: number): Money {
  return roundMoney(new Prisma.Decimal(unitPrice).times(quantity));
}

export function isPositive(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).greaterThan(0);
}

export function isNonNegative(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).greaterThanOrEqualTo(0);
}

export function moneyEquals(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(a).equals(b);
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function isValidCurrencyCode(code: string): boolean {
  return CURRENCY_CODE_PATTERN.test(code);
}

/** No arithmetic is ever performed across two different currencies (§32) — every call site that combines two records' amounts checks this first. */
export function assertSameCurrency(a: string, b: string, context = "these records"): void {
  if (a !== b) {
    throw new ValidationError(`Currency mismatch: ${context} use different currencies (${a} vs ${b}).`);
  }
}

/** Formats for display — "OMR 1,250.000". Never used as a calculation input; calculations always use the Decimal value directly. */
export function formatMoney(value: Prisma.Decimal.Value, currency: string): string {
  const d = roundMoney(value);
  const [whole, frac] = d.toFixed(MONEY_DECIMALS).split(".");
  const withCommas = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${withCommas}.${frac}`;
}
