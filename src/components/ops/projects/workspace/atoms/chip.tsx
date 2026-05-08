import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Chip` — small pill / tag for tags, counts, modes, inline labels. Generic
// colour API (neutral / accent / olive / tan / rose) — independent of any
// entity status. The dashboard's `<WidgetStatusBadge>` stays for status-
// driven cases; both share the same colour vocabulary so they read as
// siblings, not strangers.
//
// Backgrounds use the `*-soft` token tier (12% alpha) and borders use the
// `*-line` tier (30% alpha). Both are defined in `globals.css`.

export type ChipVariant = "neutral" | "accent" | "olive" | "tan" | "rose";
export type ChipSize = "sm" | "md";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  size?: ChipSize;
}

const VARIANT_CLASS: Record<ChipVariant, string> = {
  neutral: "bg-[rgba(255,255,255,0.04)] text-text-2 border border-glass-border",
  accent: "bg-[var(--ops-accent-soft)] text-ops-accent border border-[var(--ops-accent-line)]",
  olive: "bg-[var(--olive-soft)] text-[var(--olive)] border border-[var(--olive-line)]",
  tan: "bg-[var(--tan-soft)] text-[var(--tan)] border border-[var(--tan-line)]",
  rose: "bg-[var(--rose-soft)] text-[var(--rose)] border border-[var(--rose-line)]",
};

const SIZE_CLASS: Record<ChipSize, string> = {
  sm: "text-[9px] leading-[1.3] px-1 py-[1px] tracking-[0.12em]",
  md: "text-[10px] leading-[1.3] px-1.5 py-[2px] tracking-[0.1em]",
};

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ variant = "neutral", size = "sm", className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 whitespace-nowrap",
        "font-mono uppercase rounded-chip",
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";
