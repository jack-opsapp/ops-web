import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Body` — workspace body voice. Mohave, sentence case (no forced uppercase).
// Sized 12 / 14 / 16 / 18 and coloured along the spec-v2 text ladder.
// Renders as a `<span>` by default; pass `as="p"` (or `"div"`) for block
// content. Lets `Mono` and `Cake` handle the uppercase voices so this atom
// stays purpose-built for sentence-case copy.

export type BodyColor =
  | "text"
  | "text-2"
  | "text-3"
  | "mute"
  | "accent"
  | "olive"
  | "tan"
  | "rose";

export type BodySize = 12 | 14 | 16 | 18;

type BodyAs = "span" | "p" | "div";

export interface BodyProps extends React.HTMLAttributes<HTMLElement> {
  size?: BodySize;
  color?: BodyColor;
  as?: BodyAs;
}

const COLOR_CLASS: Record<BodyColor, string> = {
  text: "text-text",
  "text-2": "text-text-2",
  "text-3": "text-text-3",
  mute: "text-text-mute",
  accent: "text-ops-accent",
  olive: "text-[var(--olive)]",
  tan: "text-[var(--tan)]",
  rose: "text-[var(--rose)]",
};

// Bracket notation — see Mono atom comment for tailwind-merge rationale.
// Body line-heights run looser than Cake (1.5 read-comfortable) and tighten
// only at the largest (18) display-adjacent size.
const SIZE_CLASS: Record<BodySize, string> = {
  12: "text-[12px] leading-[1.5]",
  14: "text-[14px] leading-[1.5]",
  16: "text-[16px] leading-[1.5]",
  18: "text-[18px] leading-[1.4]",
};

export const Body = React.forwardRef<HTMLElement, BodyProps>(
  ({ size = 14, color = "text-2", as = "span", className, ...props }, ref) => {
    const Tag = as as React.ElementType;
    return (
      <Tag
        ref={ref}
        className={cn(
          "font-mohave",
          SIZE_CLASS[size],
          COLOR_CLASS[color],
          className,
        )}
        {...props}
      />
    );
  },
);
Body.displayName = "Body";
