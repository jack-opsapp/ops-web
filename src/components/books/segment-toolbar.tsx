"use client";

/**
 * Books working-area chrome that is genuinely Books-specific: the segment
 * stat line (metric parity for the retired per-tab MetricsHeaders) and the
 * metric formatter. The segment control, filter chips, and dismiss chip
 * were promoted to the shared primitives in `@/components/ui/` —
 * re-exported here so Books call sites read naturally.
 */

import type { MetricColumnConfig } from "@/components/metrics/types";

export {
  SegmentControl as BooksSegmentControl,
  type SegmentControlOption as BooksSegmentOption,
} from "@/components/ui/segment-control";
export { FilterChips, DismissChip as DrillChip } from "@/components/ui/filter-chip";

// ─── Stat line (per-segment metric parity, D5) ───────────────────────────────

export interface StatLineItem {
  label: string;
  value: string;
  tone?: "default" | "olive" | "rose" | "tan";
  /** Quiet metadata appended in parens (e.g. the metric's breakdown count). */
  note?: string;
}

const TONE_CLASS: Record<NonNullable<StatLineItem["tone"]>, string> = {
  default: "text-text-2",
  olive: "text-olive",
  rose: "text-rose",
  tan: "text-tan",
};

/** Format a MetricsService column for the stat line (always mono, formatted).
 *  Locale-aware — callers pass the active BCP 47 locale (getDateLocale). */
export function formatMetricValue(metric: MetricColumnConfig, locale: string): string {
  switch (metric.formatType) {
    case "currency":
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(metric.value);
    case "percentage":
      return `${Math.round(metric.value)}%`;
    case "days":
      return `${Math.round(metric.value)}D`;
    default:
      return new Intl.NumberFormat(locale).format(metric.value);
  }
}

export function SegmentStatLine({ items }: { items: StatLineItem[] }) {
  if (items.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-micro tracking-[0.08em] text-text-3 tabular-nums">
      {items.map((item, i) => (
        <span key={item.label} className="inline-flex items-baseline gap-[6px]">
          {i > 0 && <span aria-hidden className="text-text-mute">·</span>}
          <span className="uppercase">{item.label}</span>
          <span className={TONE_CLASS[item.tone ?? "default"]}>{item.value}</span>
          {item.note && <span className="text-text-3">({item.note})</span>}
        </span>
      ))}
    </span>
  );
}
