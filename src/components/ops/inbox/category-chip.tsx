"use client";

/**
 * CategoryChip — visual badge for the thread's primary category.
 *
 * Rendered on every row of the conversation list and in the thread header.
 * Clickable variants open the RecategorizeMenu. Styled per the OPS design
 * system: borders-only, sharp 4px radius, font-cakemono uppercase at 11px
 * for the display voice, muted border palette with one accent for LEAD/CLIENT.
 */

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EmailThreadCategory } from "@/lib/types/email-thread";

// ─── Category visual tokens ──────────────────────────────────────────────────
// Border is the only color cue. All labels render in the design-system
// uppercase display voice (Cake Mono Light). Foreground text is always
// inherited text-2 so the chip stays tactical, not decorative.

interface CategoryStyle {
  border: string;     // rgba border color (hex okay — decorative, not text)
  label: string;      // display label (uppercase, single-line)
  dotColor: string;   // matches border, used for list-row quick scans
}

const CATEGORY_STYLES: Record<EmailThreadCategory, CategoryStyle> = {
  LEAD:         { border: "#6F94B0", label: "LEAD",         dotColor: "#6F94B0" },
  CLIENT:       { border: "#6F94B0", label: "CLIENT",       dotColor: "#6F94B0" },
  VENDOR:       { border: "#6b7280", label: "VENDOR",       dotColor: "#6b7280" },
  SUBTRADE:     { border: "#6b7280", label: "SUBTRADE",     dotColor: "#6b7280" },
  PLATFORM_BID: { border: "#8b7e3a", label: "PLATFORM BID", dotColor: "#8b7e3a" },
  LEGAL:        { border: "#a4584f", label: "LEGAL",        dotColor: "#a4584f" },
  JOB_SEEKER:   { border: "#6b7280", label: "JOB SEEKER",   dotColor: "#6b7280" },
  COLLECTIONS:  { border: "#a4584f", label: "COLLECTIONS",  dotColor: "#a4584f" },
  MARKETING:    { border: "#4a4a4a", label: "MARKETING",    dotColor: "#4a4a4a" },
  RECEIPT:      { border: "#4a4a4a", label: "RECEIPT",      dotColor: "#4a4a4a" },
  PERSONAL:     { border: "#4a4a4a", label: "PERSONAL",     dotColor: "#4a4a4a" },
  INTERNAL:     { border: "#4a4a4a", label: "INTERNAL",     dotColor: "#4a4a4a" },
  OTHER:        { border: "#4a4a4a", label: "OTHER",        dotColor: "#4a4a4a" },
};

export function categoryLabel(category: EmailThreadCategory): string {
  return CATEGORY_STYLES[category].label;
}

export function categoryDotColor(category: EmailThreadCategory): string {
  return CATEGORY_STYLES[category].dotColor;
}

// ─── Chip props ──────────────────────────────────────────────────────────────

export type CategoryChipSize = "sm" | "md";

interface CategoryChipProps {
  category: EmailThreadCategory;
  /** Size: sm = list rows (18px tall), md = thread header (22px tall). */
  size?: CategoryChipSize;
  /** True renders a ChevronDown and turns the chip into a button. */
  interactive?: boolean;
  /** Fires when interactive chip is clicked. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Optional — overrides the canonical label (e.g. "MANUAL"). */
  label?: string;
  /** Optional — rendered before the label text (e.g. a tiny dot). */
  leading?: React.ReactNode;
  /** Add an outer ring on manually-set categories to signal user intent. */
  manual?: boolean;
  className?: string;
  title?: string;
}

// ─── Chip ────────────────────────────────────────────────────────────────────

export const CategoryChip = forwardRef<HTMLButtonElement | HTMLSpanElement, CategoryChipProps>(
  function CategoryChip(
    { category, size = "sm", interactive = false, onClick, label, leading, manual, className, title },
    ref
  ) {
    const style = CATEGORY_STYLES[category];
    const display = label ?? style.label;

    const sizeClasses =
      size === "md"
        ? "h-[22px] px-[7px] text-[11px] tracking-[0.18em]"
        : "h-[18px] px-[6px] text-[10px] tracking-[0.16em]";

    const inner = (
      <>
        {leading}
        <span className="leading-none">{display}</span>
        {interactive && (
          <ChevronDown
            className={cn("shrink-0", size === "md" ? "h-[11px] w-[11px]" : "h-[10px] w-[10px]")}
            strokeWidth={1.75}
          />
        )}
      </>
    );

    const base = cn(
      "inline-flex items-center gap-[4px] rounded-chip",
      "font-cakemono font-light uppercase text-text-2",
      "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
      sizeClasses,
      manual && "ring-1 ring-[rgba(255,255,255,0.12)]",
      className
    );

    const inlineStyle = {
      borderTop: `1px solid ${style.border}66`,
      borderRight: `1px solid ${style.border}66`,
      borderBottom: `1px solid ${style.border}66`,
      borderLeft: `2px solid ${style.border}`,
      backgroundColor: `${style.border}14`, // ~8% alpha
    } as React.CSSProperties;

    if (interactive) {
      return (
        <button
          ref={ref as React.ForwardedRef<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          title={title}
          className={cn(
            base,
            "cursor-pointer hover:text-text focus:outline-none",
            "focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-1 focus-visible:ring-offset-black"
          )}
          style={inlineStyle}
          data-category={category}
        >
          {inner}
        </button>
      );
    }

    return (
      <span
        ref={ref as React.ForwardedRef<HTMLSpanElement>}
        title={title}
        className={base}
        style={inlineStyle}
        data-category={category}
      >
        {inner}
      </span>
    );
  }
);
