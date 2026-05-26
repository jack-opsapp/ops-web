"use client";

/**
 * CategoryChip — visual badge for the thread's primary category.
 *
 * Outer shell owns all chip visual treatment: size, border-l accent stripe,
 * bg tint, rounded-chip, hover state. Inner label is delegated to
 * `<StateTag variant="bare">` (Task A2 consolidation) which contributes only
 * the text color + JetBrains Mono font — no border, no bg, no padding of its
 * own. Using "bare" prevents double-styling from "solid".
 *
 * Spec v2: every visual cue resolves to a design-system token. Tones map via
 * TONE_CHIP_CLASS (keyed on StateTagTone). Lavender (`agent.*`) absent — Claude
 * provenance only.
 */

import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import { StateTag, type StateTagTone } from "./state-tag";

// ─── Category metadata ────────────────────────────────────────────────────────

interface CategoryMeta {
  tone: StateTagTone;
  label: string;
  /** Dot bg class for callers that render a standalone colored dot. */
  dotClass: string;
}

const CATEGORY_META: Record<EmailThreadCategory, CategoryMeta> = {
  CUSTOMER:     { tone: "tan",     label: "CUSTOMER",     dotClass: "bg-tan" },
  VENDOR:       { tone: "neutral", label: "VENDOR",       dotClass: "bg-text-3" },
  SUBTRADE:     { tone: "neutral", label: "SUBTRADE",     dotClass: "bg-text-3" },
  JOB_SEEKER:   { tone: "neutral", label: "JOB SEEKER",   dotClass: "bg-text-3" },
  PLATFORM_BID: { tone: "tan",     label: "PLATFORM BID", dotClass: "bg-tan" },
  LEGAL:        { tone: "rose",    label: "LEGAL",        dotClass: "bg-rose" },
  COLLECTIONS:  { tone: "rose",    label: "COLLECTIONS",  dotClass: "bg-rose" },
  // Fix 2 (confirmed, no visual regression): MARKETING/RECEIPT/PERSONAL/INTERNAL/OTHER
  // use the neutral text tier instead of the legacy ambient tone.
  // StateTag's vocabulary has no `ambient` tone; `neutral`
  // is the closest low-priority tier. The visual delta (+brightness) is acceptable —
  // both are firmly in the muted range. dotClass retains bg-text-mute so standalone
  // colored dots stay at the darker legacy hue.
  MARKETING:    { tone: "neutral", label: "MARKETING",    dotClass: "bg-text-mute" },
  RECEIPT:      { tone: "neutral", label: "RECEIPT",      dotClass: "bg-text-mute" },
  PERSONAL:     { tone: "neutral", label: "PERSONAL",     dotClass: "bg-text-mute" },
  INTERNAL:     { tone: "neutral", label: "INTERNAL",     dotClass: "bg-text-mute" },
  OTHER:        { tone: "neutral", label: "OTHER",        dotClass: "bg-text-mute" },
};

// ─── Outer-shell tone → Tailwind class map ────────────────────────────────────
//
// Static class strings — Tailwind needs to see literals to compile them.
// The outer shell IS the chip: border-l accent stripe, hairline borders on y/r,
// and a soft bg tint. StateTag inside uses variant="bare" so it adds NO border,
// bg, or padding — just the tonal text color and JetBrains Mono font.
//
// Tones used by CategoryChip (subset of StateTagTone; accent/olive/lavender unused):
//   tan     → CUSTOMER + PLATFORM_BID
//   neutral → VENDOR / SUBTRADE / JOB_SEEKER + low-priority (MARKETING / RECEIPT / PERSONAL / INTERNAL / OTHER)
//   rose    → LEGAL / COLLECTIONS
const TONE_CHIP_CLASS: Record<StateTagTone, string> = {
  tan:      "border-y border-r border-l-2 border-tan/40     border-l-tan     bg-tan/[0.08]",
  neutral:  "border-y border-r border-l-2 border-text-3/40  border-l-text-3  bg-text-3/[0.08]",
  rose:     "border-y border-r border-l-2 border-rose/40    border-l-rose    bg-rose/[0.08]",
  // Remaining tones are not used by CategoryChip but must be present for the
  // Record<StateTagTone, string> constraint. Fallback to neutral shell treatment.
  accent:   "border-y border-r border-l-2 border-ops-accent/40 border-l-ops-accent bg-ops-accent/[0.08]",
  olive:    "border-y border-r border-l-2 border-olive/40   border-l-olive   bg-olive/[0.08]",
  lavender: "border-y border-r border-l-2 border-agent-border-hi border-l-agent-hi bg-agent/[0.08]",
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
  return resolveMeta(category).dotClass;
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

  // Size controls the wrapper's height/padding only. The inner StateTag is fixed
  // at 11px per spec — its font size comes from StateTag itself, not sizeClasses.
  const sizeClasses =
    size === "md"
      ? "h-[22px] px-[7px]"
      : "h-[18px] px-[6px]";

  const inner = (
    <>
      {leading}
      {/* variant="bare" — outer shell owns border/bg/radius; StateTag provides
          only tonal text color + JetBrains Mono (no double-styling). */}
      <StateTag tone={meta.tone} variant="bare" prefix={display} bracketed />
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
          "cursor-pointer hover:brightness-125 focus:outline-none",
          "focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
