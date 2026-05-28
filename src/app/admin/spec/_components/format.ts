/**
 * Shared formatters for the SPEC admin views. Numbers always render in
 * JetBrains Mono with tabular-lining + slashed-zero (handled at the CSS level
 * by `.font-mono` + `font-feature-settings: "tnum" 1, "zero" 1` inherited from
 * the design tokens). These helpers only normalize the digit string.
 */

const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const CAD_DECIMAL = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return Math.abs(dollars % 1) < 0.005 ? CAD.format(dollars) : CAD_DECIMAL.format(dollars);
}

export function formatCentsCompact(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return CAD.format(dollars);
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-CA").format(n);
}

export function formatDays(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n}d`;
}

export function formatTier(tier: string): string {
  return tier.toUpperCase();
}

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

export function formatHoldType(hold: "customer_requested" | "ops_blocked" | null): string | null {
  if (!hold) return null;
  return hold === "customer_requested" ? "HOLD · CUSTOMER" : "HOLD · BLOCKED";
}
