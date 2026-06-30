"use client";

/**
 * MetricsStrip — the ONE metric bar across every table surface (WEB OVERHAUL P6-2).
 *
 * Reconciles the five pre-unification treatments into a single pinned strip:
 *   - MetricsHeader `variant="compact"` (Projects)
 *   - MetricsHeader `variant="full"` + slashLabels (Pipeline)
 *   - InstrumentStrip glance-tile decks — LedgerStrip (Books), SupplyStrip (Catalog)
 *   - SegmentStatLine inline row (Books invoices/estimates) → folds into the workbar
 *   - ClientsArBanner (Clients) → becomes the lead cell
 *
 * Anatomy per cell: `// LABEL` (mono micro) · a tabular mono hero value with the
 * shared count-up · an optional trend · an optional per-cell mini-viz (StripViz:
 * sparkline / bars / meter / ramp) · an optional `// SUB` line. A cell with
 * `onClick` becomes a focusable drill button. Lives inside a TableShell, so it
 * carries no glass of its own — just the panel's top tier with a hairline base.
 *
 * Tokenized end-to-end: drops MetricsHeader's hardcoded hex (#6B6B6B / #A5B368 /
 * #93321A / #EDEDED / rgba(10,10,10,.5)). Numbers are JetBrains Mono, tabular.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useAnimatedValue } from "@/components/metrics/hooks/useAnimatedValue";
import { StripViz, type StripVizConfig } from "./strip-viz";

export type MetricTone = "default" | "olive" | "tan" | "rose";

export interface MetricCell {
  /** `// LABEL` — uppercased mono micro. */
  label: string;
  /**
   * Numeric target → count-up + `format`. String → rendered as-is (e.g. "NOMINAL",
   * a pre-formatted "$38,175", or "—" for an empty register).
   */
  value: number | string;
  /** Formatter for numeric values. Defaults to a locale integer. */
  format?: (n: number) => string;
  tone?: MetricTone;
  trend?: { direction: "up" | "down" | "flat"; value: string; sentiment?: "positive" | "negative" | "neutral" };
  /** Per-cell mini-viz. */
  viz?: StripVizConfig;
  /** Terse context line under the viz — a string, or rich nodes (e.g. colored in/out splits). */
  sub?: ReactNode;
  /** Turns the cell into a focusable drill button (e.g. A/R → overdue filter). */
  onClick?: () => void;
  /** Override the composed aria-label. */
  ariaLabel?: string;
}

export interface MetricsStripProps {
  metrics: MetricCell[];
  /** Optional control at the far right of the row (e.g. a period pill). */
  right?: ReactNode;
  isLoading?: boolean;
  /** Section label rendered before the cells (e.g. "LEDGER"). Optional. */
  label?: string;
  ariaLabel?: string;
  className?: string;
}

const TONE_CLASS: Record<MetricTone, string> = {
  default: "text-text",
  olive: "text-olive",
  tan: "text-tan",
  rose: "text-rose",
};

const TREND_CLASS = {
  positive: "text-olive",
  negative: "text-rose",
  neutral: "text-text-mute",
} as const;

function defaultFormat(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function MetricValue({ value, format, tone }: { value: number; format?: (n: number) => string; tone?: MetricTone }) {
  const animated = useAnimatedValue(value);
  const fmt = format ?? defaultFormat;
  return (
    <span className={cn("font-mono text-data-lg leading-none tabular-nums", TONE_CLASS[tone ?? "default"])}>
      {fmt(animated)}
    </span>
  );
}

function Trend({ trend }: { trend: NonNullable<MetricCell["trend"]> }) {
  const arrow = trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—";
  const sentiment = trend.sentiment ?? (trend.direction === "up" ? "positive" : trend.direction === "down" ? "negative" : "neutral");
  return (
    <span aria-hidden className={cn("font-mono text-micro", TREND_CLASS[sentiment])}>
      {arrow} {trend.value}
    </span>
  );
}

function Cell({ cell }: { cell: MetricCell }) {
  const ariaLabel =
    cell.ariaLabel ??
    `${cell.label}: ${typeof cell.value === "number" ? (cell.format ?? defaultFormat)(cell.value) : cell.value}${cell.trend ? `, ${cell.trend.direction} ${cell.trend.value}` : ""}`;

  const inner = (
    <>
      <div className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span aria-hidden className="text-text-mute">{"// "}</span>
        {cell.label}
      </div>
      <div className="flex items-baseline gap-1.5">
        {typeof cell.value === "number" ? (
          <MetricValue value={cell.value} format={cell.format} tone={cell.tone} />
        ) : (
          <span className={cn("font-mono text-data-lg leading-none tabular-nums", TONE_CLASS[cell.tone ?? "default"])}>{cell.value}</span>
        )}
        {cell.trend && <Trend trend={cell.trend} />}
      </div>
      {cell.viz && <div className="mt-px"><StripViz viz={cell.viz} /></div>}
      {cell.sub && (
        <div className="mt-auto pt-px font-mono text-micro tracking-[0.06em] text-text-3 tabular-nums">{cell.sub}</div>
      )}
    </>
  );

  const base = "flex min-w-[124px] flex-1 flex-col gap-[3px] border-r border-[rgba(255,255,255,0.05)] px-[15px] text-left first:pl-[3px] last:border-r-0 last:pr-[3px]";

  if (cell.onClick) {
    return (
      <button
        type="button"
        onClick={cell.onClick}
        aria-label={`${ariaLabel}. Drill in.`}
        className={cn(base, "cursor-pointer rounded-[4px] transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-inset")}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={base} role="group" aria-label={ariaLabel}>
      {inner}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex min-w-[124px] flex-1 flex-col gap-2 border-r border-[rgba(255,255,255,0.05)] px-[15px] first:pl-[3px] last:border-r-0">
      <div className="h-[11px] w-[56px] animate-pulse rounded-bar bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="h-[20px] w-[76px] animate-pulse rounded-bar bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="mt-1 h-[8px] w-full animate-pulse rounded-bar bg-fill-neutral-dim/60 motion-reduce:animate-none" />
    </div>
  );
}

export function MetricsStrip({ metrics, right, isLoading, label, ariaLabel, className }: MetricsStripProps) {
  const showSkeleton = isLoading || metrics.length === 0;
  return (
    <section
      aria-label={ariaLabel ?? label ?? "Metrics"}
      className={cn("flex items-stretch overflow-x-auto border-b border-line px-3 py-2.5 scrollbar-hide", className)}
    >
      {label && (
        <div className="mr-2 flex shrink-0 items-start pt-px font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span aria-hidden className="text-text-mute">{"// "}</span>
          {label}
        </div>
      )}
      {showSkeleton ? (
        <>
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </>
      ) : (
        metrics.map((cell) => <Cell key={cell.label} cell={cell} />)
      )}
      {right && <div className="ml-2 flex shrink-0 items-center">{right}</div>}
    </section>
  );
}
