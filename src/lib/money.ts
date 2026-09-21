/** Display-only money formatting (Phase 10). Every monetary value from the API is already a Decimal-precise string — this only ever formats for display, never for calculation (server/utils/money.ts is the single source of arithmetic). */
export function formatMoney(amount: string, currency: string): string {
  const [whole, frac = ""] = amount.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = whole.replace("-", "");
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const paddedFrac = frac.padEnd(3, "0").slice(0, 3);
  return `${currency} ${sign}${withCommas}.${paddedFrac}`;
}
