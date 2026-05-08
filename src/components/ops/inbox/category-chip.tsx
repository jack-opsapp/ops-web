"use client";

/**
 * CategoryChip — visual badge for the thread's primary category.
 *
 * Spec v2 compliance: every visual cue is a Tailwind utility resolving to a
 * design-system token. Categories collapse into five tones (active / neutral /
 * attention / negative / ambient) so the chip never holds an arbitrary hex.
 * Lavender (`agent.*`) is intentionally absent — Claude provenance only.
 */

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EmailThreadCategory } from "@/lib/types/email-thread";

// ─── Tone taxonomy ───────────────────────────────────────────────────────────

type CategoryTone =
  | "active"     // LEAD, CLIENT — live business contacts
  | "neutral"    // VENDOR, SUBTRADE, JOB_SEEKER — non-pipeline contacts
  | "attention"  // PLATFORM_BID — awaiting / pending action
  | "negative"   // LEGAL, COLLECTIONS — escalation / overdue
  | "ambient";   // MARKETING, RECEIPT, PERSONAL, INTERNAL, OTHER — low priority

interface CategoryMeta {
  tone: CategoryTone;
  label: string;
}

const CATEGORY_META: Record<EmailThreadCategory, CategoryMeta> = {
  CUSTOMER:     { tone: "active",    label: "CUSTOMER" },
  LEAD:         { tone: "active",    label: "LEAD" },
  CLIENT:       { tone: "active",    label: "CLIENT" },
  VENDOR:       { tone: "neutral",   label: "VENDOR" },
  SUBTRADE:     { tone: "neutral",   label: "SUBTRADE" },
  JOB_SEEKER:   { tone: "neutral",   label: "JOB SEEKER" },
  PLATFORM_BID: { tone: "attention", label: "PLATFORM BID" },
  LEGAL:        { tone: "negative",  label: "LEGAL" },
  COLLECTIONS:  { tone: "negative",  label: "COLLECTIONS" },
  MARKETING:    { tone: "ambient",   label: "MARKETING" },
  RECEIPT:      { tone: "ambient",   label: "RECEIPT" },
  PERSONAL:     { tone: "ambient",   label: "PERSONAL" },
  INTERNAL:     { tone: "ambient",   label: "INTERNAL" },
  OTHER:        { tone: "ambient",   label: "OTHER" },
};

// Static class strings — Tailwind needs to see literals to compile them.
// Keep this table in sync with `TONE_DOT_CLASS` below.
const TONE_CHIP_CLASS: Record<CategoryTone, string> = {
  active:    "border-y border-r border-l-2 border-text-2/40    border-l-text-2    bg-text-2/[0.08]",
  neutral:   "border-y border-r border-l-2 border-text-3/40    border-l-text-3    bg-text-3/[0.08]",
  attention: "border-y border-r border-l-2 border-tan/40       border-l-tan       bg-tan/[0.08]",
  negative:  "border-y border-r border-l-2 border-rose/40      border-l-rose      bg-rose/[0.08]",
  ambient:   "border-y border-r border-l-2 border-text-mute/40 border-l-text-mute bg-text-mute/[0.08]",
};

const TONE_DOT_CLASS: Record<CategoryTone, string> = {
  active:    "bg-text-2",
  neutral:   "bg-text-3",
  attention: "bg-tan",
  negative:  "bg-rose",
  ambient:   "bg-text-mute",
};

const FALLBACK_META: CategoryMeta = CATEGORY_META.OTHER;

function resolveMeta(
  category: EmailThreadCategory | null | undefined
): CategoryMeta {
  if (!category) return FALLBACK_META;
  return CATEGORY_META[category] ?? FALLBACK_META;
}

export function categoryLabel(category: EmailThreadCategory): string {
  const meta = CATEGORY_META[category];
  if (meta) return meta.label;
  if (typeof category === "string" && category.length > 0) {
    return category.replace(/_/g, " ").toUpperCase();
  }
  return FALLBACK_META.label;
}

/**
 * Returns a Tailwind className resolving to the canonical dot color for a
 * category. Use as `<span className={categoryDotClassName(cat)} />` — never
 * inline `style={{ backgroundColor }}` because that path bypasses tokens.
 */
export function categoryDotClassName(category: EmailThreadCategory): string {
  return TONE_DOT_CLASS[resolveMeta(category).tone];
}

// ─── Chip props ──────────────────────────────────────────────────────────────

export type CategoryChipSize = "sm" | "md";

interface CategoryChipProps {
  category: EmailThreadCategory;
  size?: CategoryChipSize;
  interactive?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  label?: string;
  leading?: React.ReactNode;
  manual?: boolean;
  className?: string;
  title?: string;
}

// ─── Chip ────────────────────────────────────────────────────────────────────

export const CategoryChip = forwardRef<
  HTMLButtonElement | HTMLSpanElement,
  CategoryChipProps
>(function CategoryChip(
  {
    category,
    size = "sm",
    interactive = false,
    onClick,
    label,
    leading,
    manual,
    className,
    title,
  },
  ref
) {
  const meta = resolveMeta(category);
  const display = label ?? categoryLabel(category);

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
          className={cn(
            "shrink-0",
            size === "md" ? "h-[11px] w-[11px]" : "h-[10px] w-[10px]"
          )}
          strokeWidth={1.5}
        />
      )}
    </>
  );

  const base = cn(
    "inline-flex items-center gap-[4px] rounded-chip",
    "font-cakemono font-light uppercase text-text-2",
    "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
    sizeClasses,
    TONE_CHIP_CLASS[meta.tone],
    manual && "ring-1 ring-white/[0.12]",
    className
  );

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
      data-category={category}
    >
      {inner}
    </span>
  );
});
