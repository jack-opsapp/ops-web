import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Hairline` — 1px separator. Horizontal (default) or vertical, solid or
// dashed. Border colour traces to the `glass-border` token tier (mapped to
// `var(--glass-border*)` in `globals.css`) so emphasis stays system-wide.
// Decorative; exposes `role="separator"` for AT.

export type HairlineOrientation = "horizontal" | "vertical";
export type HairlineVariant = "solid" | "dashed";
export type HairlineEmphasis = "subtle" | "medium" | "strong";

export interface HairlineProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: HairlineOrientation;
  variant?: HairlineVariant;
  emphasis?: HairlineEmphasis;
}

const EMPHASIS_CLASS: Record<HairlineEmphasis, string> = {
  subtle: "border-glass-border",
  medium: "border-glass-border-medium",
  strong: "border-glass-border-strong",
};

export const Hairline = React.forwardRef<HTMLDivElement, HairlineProps>(
  (
    {
      orientation = "horizontal",
      variant = "solid",
      emphasis = "subtle",
      className,
      role,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      role={role ?? "separator"}
      aria-orientation={orientation}
      className={cn(
        orientation === "horizontal" ? "w-full h-px border-t" : "h-full w-px border-l",
        variant === "dashed" ? "border-dashed" : "border-solid",
        EMPHASIS_CLASS[emphasis],
        className,
      )}
      {...props}
    />
  ),
);
Hairline.displayName = "Hairline";
