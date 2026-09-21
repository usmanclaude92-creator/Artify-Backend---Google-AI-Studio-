/** Phase 10 §39 — Decimal-safe financial primitives: explicit float-precision traps, rounding, currency validation. */
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { addMoney, assertSameCurrency, formatMoney, isNonNegative, isPositive, isValidCurrencyCode, moneyEquals, multiplyMoney, roundMoney, subtractMoney, sumMoney, toMoney } from "../../server/utils/money";
import { calculateContractCurrentValue, calculateInvoiceBalance, calculateInvoiceTotals, calculateLineItem, effectiveInvoiceStatus } from "../../server/services/billingCalculations";
import { ValidationError } from "../../server/core/errors";

describe("money — Decimal-safe arithmetic (Phase 10 §39)", () => {
  it("0.100 + 0.200 equals exactly 0.300, never the 0.30000000000000004 float artifact", () => {
    const sum = addMoney("0.100", "0.200");
    expect(sum.toString()).toBe("0.3");
    expect(moneyEquals(sum, "0.300")).toBe(true);
    // The float trap this test guards against — proof the native operator misbehaves so the guard is meaningful.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("multiplies quantity × unit price with no float drift across many fractional cents", () => {
    const total = multiplyMoney("19.995", 3);
    expect(total.toString()).toBe("59.985");
  });

  it("rounds to exactly 3 decimal places using ROUND_HALF_UP", () => {
    expect(roundMoney("1.2345").toString()).toBe("1.235");
    expect(roundMoney("1.2344").toString()).toBe("1.234");
    expect(roundMoney("1.0005").toString()).toBe("1.001");
  });

  it("sums a list of amounts without accumulating float error", () => {
    const values = Array(10).fill("0.1");
    expect(sumMoney(values).toString()).toBe("1");
  });

  it("subtractMoney never produces a signed-zero or float remainder artifact", () => {
    expect(subtractMoney("10.000", "10.000").toString()).toBe("0");
  });

  it("isPositive/isNonNegative behave correctly at the zero boundary", () => {
    expect(isPositive(toMoney(0))).toBe(false);
    expect(isPositive(toMoney("0.001"))).toBe(true);
    expect(isNonNegative(toMoney(0))).toBe(true);
    expect(isNonNegative(toMoney("-0.001"))).toBe(false);
  });

  it("validates ISO 4217-shaped currency codes", () => {
    expect(isValidCurrencyCode("OMR")).toBe(true);
    expect(isValidCurrencyCode("usd")).toBe(false);
    expect(isValidCurrencyCode("US")).toBe(false);
  });

  it("assertSameCurrency throws on any mismatch, never performs cross-currency arithmetic", () => {
    expect(() => assertSameCurrency("OMR", "USD")).toThrow(ValidationError);
    expect(() => assertSameCurrency("OMR", "OMR")).not.toThrow();
  });

  it("formatMoney renders OMR with 3 decimals and thousands separators", () => {
    expect(formatMoney("1250", "OMR")).toBe("OMR 1,250.000");
    expect(formatMoney("1000000.5", "OMR")).toBe("OMR 1,000,000.500");
  });
});

describe("billingCalculations — the single source of invoice/contract math (Phase 10 §14)", () => {
  it("calculateLineItem: lineTotal = quantity × unitPrice − discount, Decimal-exact", () => {
    const line = calculateLineItem({ quantity: 3, unitPrice: toMoney("19.995"), discount: toMoney("1.005") });
    expect(line.lineTotal.toString()).toBe("58.98");
  });

  it("calculateLineItem rejects a discount exceeding the line's gross value", () => {
    expect(() => calculateLineItem({ quantity: 1, unitPrice: toMoney("10.000"), discount: toMoney("10.001") })).toThrow(ValidationError);
  });

  it("calculateLineItem rejects a non-positive quantity", () => {
    expect(() => calculateLineItem({ quantity: 0, unitPrice: toMoney("10"), discount: toMoney("0") })).toThrow(ValidationError);
  });

  it("calculateInvoiceTotals: subtotal = Σ lineTotal, total = subtotal − discount + tax", () => {
    const lines = [
      calculateLineItem({ quantity: 2, unitPrice: toMoney("100.000"), discount: toMoney("0") }),
      calculateLineItem({ quantity: 1, unitPrice: toMoney("50.500"), discount: toMoney("0.500") }),
    ];
    const totals = calculateInvoiceTotals(lines, toMoney("10.000"), toMoney("5.000"));
    expect(totals.subtotal.toString()).toBe("250"); // 200 + 50
    expect(totals.total.toString()).toBe("245"); // 250 - 10 + 5
  });

  it("calculateInvoiceTotals rejects an invoice discount that exceeds subtotal + tax", () => {
    const lines = [calculateLineItem({ quantity: 1, unitPrice: toMoney("10"), discount: toMoney("0") })];
    expect(() => calculateInvoiceTotals(lines, toMoney("100"), toMoney("0"))).toThrow(ValidationError);
  });

  it("calculateInvoiceBalance recomputes amountPaid/amountDue purely from completed payment amounts", () => {
    const balance = calculateInvoiceBalance(toMoney("300.000"), [toMoney("100.000"), toMoney("50.000")]);
    expect(balance.amountPaid.toString()).toBe("150");
    expect(balance.amountDue.toString()).toBe("150");
  });

  it("calculateInvoiceBalance never goes negative even if given more payments than the total (floor at zero)", () => {
    const balance = calculateInvoiceBalance(toMoney("100.000"), [toMoney("100.000"), toMoney("50.000")]);
    expect(balance.amountDue.toString()).toBe("0");
  });

  it("calculateContractCurrentValue: original + Σ(variation amounts), variations may be negative", () => {
    const current = calculateContractCurrentValue(toMoney("10000.000"), [toMoney("500.000"), toMoney("-200.000")]);
    expect(current.toString()).toBe("10300");
  });

  it("effectiveInvoiceStatus computes OVERDUE from ISSUED + a past due date, never mutates the stored status", () => {
    const now = new Date("2026-06-15");
    expect(effectiveInvoiceStatus({ status: "ISSUED", dueDate: new Date("2026-06-01") }, now)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus({ status: "ISSUED", dueDate: new Date("2026-07-01") }, now)).toBe("ISSUED");
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: new Date("2026-06-01") }, now)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus({ status: "PAID", dueDate: new Date("2026-06-01") }, now)).toBe("PAID");
    expect(effectiveInvoiceStatus({ status: "DRAFT", dueDate: new Date("2026-06-01") }, now)).toBe("DRAFT");
  });

  it("Prisma.Decimal.toJSON() serializes as a string, never a lossy float — confirming no manual BigInt-style conversion is needed at the API boundary", () => {
    const value = new Prisma.Decimal("1234.500");
    expect(JSON.parse(JSON.stringify({ amount: value })).amount).toBe("1234.5");
  });
});
