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
 * sparkline / bars / meter / ramp) · an optional `// SUB` line. A cell with a
 * `breakdown` becomes a focusable button that flips to reveal the formula behind
 * the number — the one and only metric interaction. Lives inside a TableShell, so
 * it carries no glass of its own — just the panel's top tier with a hairline base.
 *
 * Tokenized end-to-end: drops MetricsHeader's hardcoded hex (#6B6B6B / #A5B368 /
 * #93321A / #EDEDED / rgba(10,10,10,.5)). Numbers are JetBrains Mono, tabular.
 */

import { useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useAnimatedValue } from "@/components/metrics/hooks/useAnimatedValue";
import { StripViz, type StripVizConfig } from "./strip-viz";

export type MetricTone = "default" | "olive" | "tan" | "rose";

// Card-flip motion — the ONE metric interaction (DESIGN.md §8: card flip = 350ms
// EASE_SMOOTH; reduced motion → opacity crossfade at 150ms). Canonical curve.
const FLIP_MS = 350;
const CROSSFADE_MS = 150;
const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

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
  /**
   * Formula behind the number (e.g. "12 won ÷ 15 decided"). When set, the cell
   * becomes a focusable button that flips to reveal this line — the ONE metric
   * interaction app-wide. When unset, the cell is a static readout.
   */
  breakdown?: string;
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
    <span className={cn("font-mono text-display tracking-[-1px] leading-none tabular-nums", TONE_CLASS[tone ?? "default"])}>
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

// Structural cell frame (flex item, hairline divider, gutter). The face stack is
// applied on top — on the cell itself when static, on each face when it flips.
const CELL_LAYOUT =
  "min-w-[136px] flex-1 border-r border-border-subtle px-[18px] text-left first:pl-0 last:border-r-0 last:pr-0";
const FACE_STACK = "flex flex-col gap-[3px]";

function Cell({ cell }: { cell: MetricCell }) {
  const [flipped, setFlipped] = useState(false);
  const reduced = useReducedMotion();
  const canFlip = !!cell.breakdown;

  const ariaLabel =
    cell.ariaLabel ??
    `${cell.label}: ${typeof cell.value === "number" ? (cell.format ?? defaultFormat)(cell.value) : cell.value}${cell.trend ? `, ${cell.trend.direction} ${cell.trend.value}` : ""}`;

  const front = (
    <>
      <div className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span aria-hidden className="text-text-mute">{"// "}</span>
        {cell.label}
      </div>
      <div className="flex items-baseline gap-1.5">
        {typeof cell.value === "number" ? (
          <MetricValue value={cell.value} format={cell.format} tone={cell.tone} />
        ) : (
          <span className={cn("font-mono text-display tracking-[-1px] leading-none tabular-nums", TONE_CLASS[cell.tone ?? "default"])}>{cell.value}</span>
        )}
        {cell.trend && <Trend trend={cell.trend} />}
      </div>
      {cell.viz && <div className="mt-px"><StripViz viz={cell.viz} /></div>}
      {cell.sub && (
        <div className="mt-auto pt-px font-mono text-micro tracking-[0.06em] text-text-3 tabular-nums">{cell.sub}</div>
      )}
    </>
  );

  // A cell with no formula stays a plain, non-interactive readout.
  if (!canFlip) {
    return (
      <div className={cn(CELL_LAYOUT, FACE_STACK)} role="group" aria-label={ariaLabel}>
        {front}
      </div>
    );
  }

  // Back face — the formula behind the number. Same `// LABEL` grammar, then the
  // breakdown line in the data-mono readout tier.
  const back = (
    <>
      <div className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span aria-hidden className="text-text-mute">{"// "}</span>
        {cell.label}
      </div>
      <div className="font-mono text-data-sm leading-snug text-text-2">{cell.breakdown}</div>
    </>
  );

  // Reduced motion → opacity crossfade (no rotation); full motion → 3D rotateY.
  // Front stays in flow so it defines cell height; back is absolute inset-0.
  const rotor = reduced ? (
    <div className="relative h-full w-full">
      <div className={cn("h-full", FACE_STACK)} aria-hidden={flipped} style={{ opacity: flipped ? 0 : 1, transition: `opacity ${CROSSFADE_MS}ms ease` }}>
        {front}
      </div>
      <div className={cn("absolute inset-0", FACE_STACK)} aria-hidden={!flipped} style={{ opacity: flipped ? 1 : 0, transition: `opacity ${CROSSFADE_MS}ms ease` }}>
        {back}
      </div>
    </div>
  ) : (
    <div
      className="relative h-full w-full"
      style={{
        transformStyle: "preserve-3d",
        transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        transition: `transform ${FLIP_MS}ms ${EASE_CSS}`,
      }}
    >
      <div className={cn("h-full", FACE_STACK)} aria-hidden={flipped} style={{ backfaceVisibility: "hidden" }}>
        {front}
      </div>
      <div className={cn("absolute inset-0", FACE_STACK)} aria-hidden={!flipped} style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
        {back}
      </div>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-pressed={flipped}
      aria-label={`${ariaLabel}. Show formula.`}
      className={cn(CELL_LAYOUT, "relative cursor-pointer rounded-chip transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-inset")}
      style={{ perspective: 600 }}
    >
      {rotor}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex min-w-[136px] flex-1 flex-col gap-2 border-r border-border-subtle px-[18px] first:pl-0 last:border-r-0 last:pr-0">
      <div className="h-[11px] w-[56px] animate-pulse rounded-bar bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="h-[28px] w-[84px] animate-pulse rounded-bar bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="mt-1 h-[8px] w-full animate-pulse rounded-bar bg-fill-neutral-dim/60 motion-reduce:animate-none" />
    </div>
  );
}

export function MetricsStrip({ metrics, right, isLoading, label, ariaLabel, className }: MetricsStripProps) {
  const showSkeleton = isLoading || metrics.length === 0;
  return (
    <section
      aria-label={ariaLabel ?? label ?? "Metrics"}
      className={cn("flex items-stretch overflow-x-auto border-b border-line px-3 py-3 scrollbar-hide", className)}
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
