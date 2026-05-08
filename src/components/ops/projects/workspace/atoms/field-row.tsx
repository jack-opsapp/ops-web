import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `FieldRow` — horizontal layout for a row of Field cells. Two modes:
//   - flex (default) — equal-flexing cells, simplest case
//   - grid (when `columns` is provided) — proportional widths via
//     `gridTemplateColumns` (e.g. `["1fr", "auto"]` for label-then-value)
//
// Gap from the 8-pt token scale.

export type FieldRowGap = 0.5 | 1 | 1.5 | 2 | 3;

export interface FieldRowProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: FieldRowGap;
  columns?: string[];
}

const GAP_CLASS: Record<FieldRowGap, string> = {
  0.5: "gap-0.5",
  1: "gap-1",
  1.5: "gap-1.5",
  2: "gap-2",
  3: "gap-3",
};

export const FieldRow = React.forwardRef<HTMLDivElement, FieldRowProps>(
  ({ gap = 2, columns, className, style, ...props }, ref) => {
    const isGrid = Array.isArray(columns) && columns.length > 0;
    return (
      <div
        ref={ref}
        className={cn(
          isGrid ? "grid" : "flex flex-row",
          GAP_CLASS[gap],
          className,
        )}
        style={
          isGrid
            ? { ...style, gridTemplateColumns: columns!.join(" ") }
            : style
        }
        {...props}
      />
    );
  },
);
FieldRow.displayName = "FieldRow";
