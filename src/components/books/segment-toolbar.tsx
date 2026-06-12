"use client";

/**
 * Shared Books working-area chrome (direction A): the segment control,
 * status filter chips, drill chip, and the quiet segment stat line.
 * Approved pixels: docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html
 */

import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { MetricColumnConfig } from "@/components/metrics/types";

// ─── Segment control ──────────────────────────────────────────────────────────

export interface BooksSegmentOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional right-aligned mono count. */
  count?: number;
}

export function BooksSegmentControl<T extends string = string>({
  options,
  value,
  onChange,
}: {
  options: BooksSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex gap-[2px] rounded-[7px] border border-border p-[3px]" role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-[18px] py-[6px]",
              "font-cakemono text-[13px] font-light uppercase tracking-[0.02em]",
              "border transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
            )}
          >
            {opt.label}
            {typeof opt.count === "number" && (
              <span className="font-mono text-micro-sm text-text-mute tabular-nums">
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
}

export function FilterChips<T extends string = string>({
  options,
  value,
  onChange,
}: {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-[6px]">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-[4px] border px-[10px] py-[4px]",
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              "transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Rose drill chip dropped by a ledger-strip drill ("OVERDUE ×"). */
export function DrillChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className={cn(
        "inline-flex items-center gap-[6px] rounded-[4px] border border-rose-line bg-rose-soft px-[10px] py-[4px]",
        "font-mono text-micro font-medium uppercase tracking-[0.12em] text-rose",
        "transition-colors duration-150 ease-smooth hover:bg-[rgba(181,130,137,0.2)]",
        "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
      )}
    >
      {label}
      <X className="h-[10px] w-[10px]" />
    </button>
  );
}

// ─── Stat line (per-segment metric parity, D5) ───────────────────────────────

export interface StatLineItem {
  label: string;
  value: string;
  tone?: "default" | "olive" | "rose" | "tan";
}

const TONE_CLASS: Record<NonNullable<StatLineItem["tone"]>, string> = {
  default: "text-text-2",
  olive: "text-olive",
  rose: "text-rose",
  tan: "text-tan",
};

/** Format a MetricsService column for the stat line (always mono, formatted). */
export function formatMetricValue(metric: MetricColumnConfig): string {
  switch (metric.formatType) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(metric.value);
    case "percentage":
      return `${Math.round(metric.value)}%`;
    case "days":
      return `${Math.round(metric.value)}D`;
    default:
      return new Intl.NumberFormat("en-US").format(metric.value);
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
        </span>
      ))}
    </span>
  );
}
