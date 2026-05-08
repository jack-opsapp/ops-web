import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Cake` — heavy uppercase display voice (Cake Mono Light, weight 300 only).
// Used for page titles, section headers, card titles. Cake Mono Regular and
// Bold are intentionally not exposed — the brand spec mandates Light only
// in product UI. Sizes follow the spec display ladder; colours follow the
// spec-v2 text ladder + accent + earth-tone semantics.

export type CakeColor =
  | "text"
  | "text-2"
  | "text-3"
  | "mute"
  | "accent"
  | "olive"
  | "tan"
  | "rose";

export type CakeSize = 18 | 22 | 28 | 32 | 48 | 64;

export interface CakeProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: CakeSize;
  color?: CakeColor;
}

const COLOR_CLASS: Record<CakeColor, string> = {
  text: "text-text",
  "text-2": "text-text-2",
  "text-3": "text-text-3",
  mute: "text-text-mute",
  accent: "text-ops-accent",
  olive: "text-[var(--olive)]",
  tan: "text-[var(--tan)]",
  rose: "text-[var(--rose)]",
};

// Bracket notation — see Mono atom for the tailwind-merge rationale.
// Line-heights tighten as size grows (display tier prefers tight stacks).
const SIZE_CLASS: Record<CakeSize, string> = {
  18: "text-[18px] leading-[1.2]",
  22: "text-[22px] leading-[1.15]",
  28: "text-[28px] leading-[1.1]",
  32: "text-[32px] leading-[1.05]",
  48: "text-[48px] leading-[1.02]",
  64: "text-[64px] leading-[1]",
};

export const Cake = React.forwardRef<HTMLSpanElement, CakeProps>(
  ({ size = 22, color = "text", className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "font-cakemono font-light uppercase",
        SIZE_CLASS[size],
        COLOR_CLASS[color],
        className,
      )}
      {...props}
    />
  ),
);
Cake.displayName = "Cake";
