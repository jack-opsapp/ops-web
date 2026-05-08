import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Inline` — horizontal flex row with a token-based gap. Pairs with `Stack`:
// Stack stacks rows vertically, Inline lays out items within a row. Defaults
// to `items-center` because workspace toolbars and metadata strips almost
// always centre vertically.

export type InlineGap = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4;
export type InlineAlign = "start" | "center" | "end" | "baseline";
export type InlineJustify = "start" | "center" | "end" | "between";

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: InlineGap;
  align?: InlineAlign;
  justify?: InlineJustify;
  wrap?: boolean;
}

const GAP_CLASS: Record<InlineGap, string> = {
  0: "gap-0",
  0.5: "gap-0.5",
  1: "gap-1",
  1.5: "gap-1.5",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
};

const ALIGN_CLASS: Record<InlineAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
};

const JUSTIFY_CLASS: Record<InlineJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

export const Inline = React.forwardRef<HTMLDivElement, InlineProps>(
  ({ gap = 1, align = "center", justify, wrap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-row",
        GAP_CLASS[gap],
        ALIGN_CLASS[align],
        justify && JUSTIFY_CLASS[justify],
        wrap && "flex-wrap",
        className,
      )}
      {...props}
    />
  ),
);
Inline.displayName = "Inline";
