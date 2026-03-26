/**
 * Format a number as abbreviated currency: $850, $124.8K, $1.2M
 * No cents displayed. Used exclusively in metrics headers.
 */
export function formatMetricCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (abs < 1000) {
    return `${sign}$${Math.round(abs)}`;
  }
  if (abs < 1_000_000) {
    const k = abs / 1000;
    return `${sign}$${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}K`;
  }
  const m = abs / 1_000_000;
  return `${sign}$${Number(m.toFixed(1))}M`;
}

/**
 * Format a metric value based on its type.
 */
export function formatMetricValue(value: number, formatType: "currency" | "percentage" | "count" | "days"): string {
  switch (formatType) {
    case "currency":
      return formatMetricCurrency(value);
    case "percentage":
      return `${Math.round(value)}%`;
    case "count":
      return new Intl.NumberFormat("en-US").format(Math.round(value));
    case "days":
      return `${Math.round(value)}d`;
  }
}
