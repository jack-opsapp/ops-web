import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Mono` — workspace tactical-voice text primitive.
// JetBrains Mono + uppercase + tracked-out by default. Encapsulates the
// `// SLASHES`, `[brackets]`, `SYS ::` recipe so callers stop respelling it.
// Every value here traces to a design-system token (no hex, no inline px
// outside the 9/10 micro tier where Tailwind has no token).

export type MonoColor =
  | "text"
  | "text-2"
  | "text-3"
  | "mute"
  | "accent"
  | "olive"
  | "tan"
  | "rose";

export type MonoSize = 9 | 10 | 11 | 12 | 13;

export interface MonoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: MonoSize;
  color?: MonoColor;
  /** When true, content is rendered in its original case. Defaults to uppercase. */
  caseSensitive?: boolean;
}

const COLOR_CLASS: Record<MonoColor, string> = {
  text: "text-text",
  "text-2": "text-text-2",
  "text-3": "text-text-3",
  mute: "text-text-mute",
  accent: "text-ops-accent",
  olive: "text-[var(--olive)]",
  tan: "text-[var(--tan)]",
  rose: "text-[var(--rose)]",
};

// Bracket notation (not Tailwind-named tokens like `text-micro`) because
// `tailwind-merge` without a custom config treats `text-micro` /
// `text-caption-sm` / `text-data-sm` as colliding with custom colour tokens
// like `text-text-3` and silently strips one. Bracket sizes are unambiguous
// and still trace literally to the design-system px values (9/10/11/12/13).
const SIZE_CLASS: Record<MonoSize, string> = {
  9: "text-[9px] leading-[1.3]",
  10: "text-[10px] leading-[1.3]",
  11: "text-[11px] leading-[1.3]",
  12: "text-[12px] leading-[1.4]",
  13: "text-[13px] leading-[1.3]",
};

export const Mono = React.forwardRef<HTMLSpanElement, MonoProps>(
  ({ size = 11, color = "text-3", caseSensitive = false, className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "font-mono tracking-[0.18em]",
        !caseSensitive && "uppercase",
        SIZE_CLASS[size],
        COLOR_CLASS[color],
        className,
      )}
      {...props}
    />
  ),
);
Mono.displayName = "Mono";
