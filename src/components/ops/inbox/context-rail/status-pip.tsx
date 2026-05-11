"use client";

/**
 * StatusPip — faithful to `reference/v4-context-tabs.jsx :: StatusPip`.
 *
 * Renders a 6×6 dot + tone-colored label (mono 9.5/letterSpacing 0.2px).
 * Both dot and label share the tone color; the label sits inline with 5px gap.
 *
 * The label path delegates to `<StateTag>` (Task A2 consolidation).
 * The `dotOnly` escape hatch stays inline — it renders just the colored dot
 * with no label, and does not go through StateTag.
 *
 * Used by collapsed project headers, ledger rows (invoices / estimates),
 * and pipeline opportunity stage chips.
 */

import { cn } from "@/lib/utils/cn";
import { StateTag, type StateTagTone } from "../state-tag";

export type StatusTone = "ops-accent" | "tan" | "olive" | "rose" | "muted" | "text-3";

/** UI status values the inbox surfaces use. */
export type ProjectStatus =
  | "On site"
  | "Quoted"
  | "Awaiting acceptance"
  | "Done"
  | "Paid"
  | "Scheduled";

export type LedgerStatus =
  | "paid"
  | "accepted"
  | "scheduled"
  | "sent"
  | "overdue"
  | "draft"
  | "expired";

export function projectStatusTone(status: ProjectStatus): StatusTone {
  switch (status) {
    case "On site":
      return "ops-accent";
    case "Awaiting acceptance":
      return "tan";
    case "Done":
    case "Paid":
      return "olive";
    case "Quoted":
    case "Scheduled":
      return "muted";
  }
}

export function ledgerStatusTone(status: LedgerStatus): StatusTone {
  switch (status) {
    case "paid":
    case "accepted":
      return "olive";
    case "scheduled":
    case "sent":
      return "muted";
    case "overdue":
    case "expired":
      return "rose";
    case "draft":
      return "text-3";
  }
}

const DOT_BG: Record<StatusTone, string> = {
  "ops-accent": "bg-ops-accent",
  tan: "bg-tan",
  olive: "bg-olive",
  rose: "bg-rose",
  muted: "bg-text-mute",
  "text-3": "bg-text-3",
};

/** Map the local StatusTone vocabulary to the StateTagTone primitive vocabulary. */
const STATUS_TONE_TO_TAG_TONE: Record<StatusTone, StateTagTone> = {
  "ops-accent": "accent",
  tan: "tan",
  olive: "olive",
  rose: "rose",
  muted: "neutral",
  "text-3": "neutral",
};

interface StatusPipProps {
  /** Pre-tinted variant — explicit tone. */
  tone?: StatusTone;
  /** Convenience: pass a project-status string and let the helper resolve tone. */
  status?: ProjectStatus;
  /** Visible label. Uppercase rendering is the caller's choice (CSS). */
  label: string;
  /** Hide the label and render the dot only. */
  dotOnly?: boolean;
  className?: string;
}

export function StatusPip({
  tone,
  status,
  label,
  dotOnly,
  className,
}: StatusPipProps) {
  const resolvedTone =
    tone ?? (status ? projectStatusTone(status) : "muted");

  if (dotOnly) {
    return (
      <span
        data-testid="status-pip"
        aria-label={label}
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          DOT_BG[resolvedTone],
          className,
        )}
      />
    );
  }

  const tagTone = STATUS_TONE_TO_TAG_TONE[resolvedTone];

  return (
    <span
      data-testid="status-pip"
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_BG[resolvedTone])}
      />
      <StateTag tone={tagTone} variant="bare" prefix={label} />
    </span>
  );
}
