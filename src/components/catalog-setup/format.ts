// Number formatting for the catalog-setup canvas data rows.
//
// Numbers in OPS are ALWAYS mono, tabular-lining, slashed-zero, and FORMATTED —
// never a raw float ($86.5671641 is a design failure; "$87" / "$86.57" is right).
// These helpers keep the StagingCardView data row honest so a 14.0 reads "$14"
// and a 6.5 reads "$6.50" without per-card branching.
//
// Pure, framework-free — safe to unit-test and reuse from any canvas surface.

/** The em-dash empty-state glyph OPS uses in place of "N/A" or "0". */
export const EMPTY_GLYPH = "—";

/**
 * Money readout, e.g. 3200 → "$3,200", 6.5 → "$6.50", 9 → "$9", null → "—".
 * Whole numbers drop the cents; fractional values keep exactly two places so
 * the tabular-mono column never jitters between 1 and 3 trailing characters.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY_GLYPH;
  }
  const isWhole = Number.isInteger(value);
  const body = value.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
  return `$${body}`;
}

/**
 * Margin percent from price + cost, e.g. (3200, 1150) → "64%", missing → "—".
 * Margin = (price − cost) / price. Clamped at the display layer only by rounding
 * to a whole percent (numbers are always formatted, never raw).
 */
export function formatMargin(
  price: number | null | undefined,
  cost: number | null | undefined,
): string {
  if (
    price === null ||
    price === undefined ||
    price === 0 ||
    cost === null ||
    cost === undefined ||
    Number.isNaN(price) ||
    Number.isNaN(cost)
  ) {
    return EMPTY_GLYPH;
  }
  const pct = Math.round(((price - cost) / price) * 100);
  return `${pct}%`;
}

/** Integer count readout, e.g. 8 → "8", null → "—". */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return EMPTY_GLYPH;
  }
  return Math.round(value).toLocaleString("en-US");
}
