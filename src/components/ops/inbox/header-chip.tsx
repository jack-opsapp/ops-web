"use client";

/**
 * HeaderChip — small JetBrains-Mono counter chip rendered in the inbox
 * column header, between the rail filter dropdown and the More menu.
 *
 * Two chips share this shell:
 *   - DRAFTS  — total unsent drafts (provider + Phase C). Opens a popover
 *               listing them with discard / jump-to-thread affordances.
 *   - SNOOZED — total threads currently snoozed. Opens a popover listing
 *               them with unsnooze + open affordances.
 *
 * Both chips render only when count > 0 (see the parent gate in
 * `ThreadColumnHeader` slot). When the count is zero the chip is omitted
 * entirely — empty 0-count chips would just be screen-noise the operator
 * has to mentally subtract every visit. Glass-dense popover, panel radius
 * 12, single easing curve (cubic-bezier(0.22, 1, 0.36, 1)).
 */

import { forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

interface HeaderChipProps {
  /** The numeric count rendered in the chip body. Caller is responsible for
   *  only rendering the chip when this is > 0. */
  count: number;
  /** Localised uppercase label (e.g. "DRAFTS", "SNOOZED"). */
  label: string;
  /** Aria label — the full sentence form, e.g. "3 unsent drafts". */
  ariaLabel: string;
  /** Whether the popover is open. Controls the `data-state` styling. */
  open?: boolean;
  onClick?: () => void;
  className?: string;
}

export const HeaderChip = forwardRef<HTMLButtonElement, HeaderChipProps>(
  function HeaderChip(
    { count, label, ariaLabel, open, onClick, className },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        data-state={open ? "open" : "closed"}
        className={cn(
          "inline-flex min-w-0 shrink items-center gap-1 overflow-hidden whitespace-nowrap rounded-chip border border-line px-1.5 py-[2px]",
          "font-mono text-[11px] uppercase tracking-[0.16em] text-text-2",
          "hover:border-line-hi hover:text-text",
          "data-[state=open]:border-line-hi data-[state=open]:text-text",
          "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
          className,
        )}
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        <span aria-hidden>//</span>
        <span className="shrink-0">{count}</span>
        <span className="truncate">{label}</span>
        <span aria-hidden>▾</span>
      </button>
    );
  },
);
