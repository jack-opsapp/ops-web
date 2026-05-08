import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Stack` — vertical flex column with a token-based gap. The workspace's
// most-used layout primitive: every tab body, rail, and panel composes its
// rows with this. Gap values map 1:1 to the 8-pt Tailwind spacing scale
// (0.5=4px, 1=8px, 1.5=12px, 2=16px, 3=24px, 4=32px, 6=48px).

export type StackGap = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 6;
export type StackAlign = "start" | "center" | "end" | "stretch";

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: StackGap;
  align?: StackAlign;
}

const GAP_CLASS: Record<StackGap, string> = {
  0: "gap-0",
  0.5: "gap-0.5",
  1: "gap-1",
  1.5: "gap-1.5",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  6: "gap-6",
};

const ALIGN_CLASS: Record<StackAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ gap = 2, align, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col",
        GAP_CLASS[gap],
        align && ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  ),
);
Stack.displayName = "Stack";
