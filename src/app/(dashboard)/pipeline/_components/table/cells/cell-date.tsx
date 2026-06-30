"use client";

import { AlertTriangle } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/pipeline-table-formatters";

/**
 * Date cell. Accepts an ISO string (the adapter serializes dates to ISO).
 *
 * `overdue` is the aging/triage signal for the `next_follow_up` / `expected_close`
 * columns: when the date has passed on a still-active deal, the cell renders in
 * `rose` with a `12px` {@link AlertTriangle} and a quiet `[OVERDUE]` bracket tag.
 * Per the design system this is text + icon only — no fill, no accent. The
 * `signalKind` selects the aria label so a screen reader hears *which* date is
 * overdue (the visual tag is identical for both).
 */
export function CellDate({
  value,
  overdue = false,
  signalKind = "follow_up",
}: {
  value: string | null;
  overdue?: boolean;
  signalKind?: "follow_up" | "close";
}) {
  const { t } = useDictionary("pipeline");

  if (!overdue) {
    return (
      <span className="block truncate font-mono tabular-nums text-text-2">{formatDate(value)}</span>
    );
  }

  const ariaLabel =
    signalKind === "close"
      ? t("table.signal.closeOverdueAria")
      : t("table.signal.followUpOverdueAria");

  // Overdue = rose date + a 12px AlertTriangle. The icon + color carry the signal
  // (a non-color cue, so color-independence holds); the verbose `[OVERDUE]` bracket
  // was dropped — it overflowed the 130px date column into the next cell. The
  // sr-only label keeps the meaning for screen readers (WEB OVERHAUL P6-2 rework).
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-rose")} title={ariaLabel}>
      <AlertTriangle aria-hidden="true" className="size-3 shrink-0" strokeWidth={2} />
      <span className="truncate font-mono tabular-nums">{formatDate(value)}</span>
      <span className="sr-only">{ariaLabel}</span>
    </span>
  );
}
