"use client";

/**
 * CategoryChip — visual badge for the thread's primary category.
 *
 * Delegates all tonal inline-tag rendering to the `<StateTag>` primitive
 * (Task A2 consolidation). The outer wrapper retains its interactive shell
 * (size, forwarded ref, chevron, leading slot) while the label itself is
 * produced by StateTag solid variant.
 *
 * Lavender (`agent.*`) is intentionally absent — Claude provenance only.
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
  LEAD:         { tone: "tan",     label: "LEAD",         dotClass: "bg-tan" },
  CLIENT:       { tone: "tan",     label: "CLIENT",       dotClass: "bg-tan" },
  VENDOR:       { tone: "neutral", label: "VENDOR",       dotClass: "bg-text-3" },
  SUBTRADE:     { tone: "neutral", label: "SUBTRADE",     dotClass: "bg-text-3" },
  JOB_SEEKER:   { tone: "neutral", label: "JOB SEEKER",   dotClass: "bg-text-3" },
  PLATFORM_BID: { tone: "tan",     label: "PLATFORM BID", dotClass: "bg-tan" },
  LEGAL:        { tone: "rose",    label: "LEGAL",        dotClass: "bg-rose" },
  COLLECTIONS:  { tone: "rose",    label: "COLLECTIONS",  dotClass: "bg-rose" },
  MARKETING:    { tone: "neutral", label: "MARKETING",    dotClass: "bg-text-mute" },
  RECEIPT:      { tone: "neutral", label: "RECEIPT",      dotClass: "bg-text-mute" },
  PERSONAL:     { tone: "neutral", label: "PERSONAL",     dotClass: "bg-text-mute" },
  INTERNAL:     { tone: "neutral", label: "INTERNAL",     dotClass: "bg-text-mute" },
  OTHER:        { tone: "neutral", label: "OTHER",        dotClass: "bg-text-mute" },
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

  const inner = (
    <>
      {leading}
      <StateTag tone={meta.tone} variant="solid" prefix={display} bracketed />
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
    "inline-flex items-center gap-[4px]",
    "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
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
          "cursor-pointer focus:outline-none",
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
