/**
 * Catalog number formatting — always JetBrains Mono tabular slashed-zero at the
 * render site; these helpers produce the string. `—` for empty, never NaN/0-as-empty.
 */

const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const precise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Whole-dollar money ("$23,480"); `—` when null. */
export function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return whole.format(value);
}

/** Cents-precision money for prices/costs ("$4.20"); `—` when null. */
export function fmtMoneyPrecise(value: number | null | undefined): string {
  if (value == null) return "—";
  // Drop trailing .00 for clean whole-dollar prices like "$2,500".
  if (Number.isInteger(value)) return whole.format(value);
  return precise.format(value);
}

/** Quantity ("84", "210.5"); `0` is a real value, not empty. */
export function fmtQty(value: number | null | undefined): string {
  if (value == null) return "—";
  return qtyFmt.format(value);
}

/** Margin percent ("42%"); `—` when null. */
export function fmtMargin(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${Math.round(pct)}%`;
}

/**
 * Parse an inline quantity edit. A leading `+`/`-` means a signed delta
 * (received / removed); a bare number is an absolute set-to count. Returns
 * null for empty / non-numeric input.
 */
export function parseQtyInput(
  raw: string,
): { mode: "set" | "delta"; value: number } | null {
  const s = raw.trim();
  if (s === "") return null;
  const signed = /^[+-]/.test(s);
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return signed ? { mode: "delta", value: n } : { mode: "set", value: n };
}

/** Parse a dollar input ("$4.20", "4.2", "") → number or null. */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/[$,\s]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
