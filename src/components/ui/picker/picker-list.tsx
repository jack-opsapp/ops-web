"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "@/lib/utils/cn";

/** Scrollable list wrapper. Scroll is contained; default cap 280px. */
const PickerList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      // Real px, not scale tokens — the doubled spacing scale would render
      // p-1 as 8px (see picker-item.tsx; the kit is authored in real px).
      "scrollbar-hide max-h-[280px] overflow-y-auto overflow-x-hidden p-[4px]",
      className,
    )}
    {...props}
  />
));
PickerList.displayName = "PickerList";

/** Canonical empty / no-results state. */
const PickerEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn(
      "px-[8px] py-[12px] text-center font-mono text-micro uppercase tracking-wider text-text-3",
      className,
    )}
    {...props}
  />
));
PickerEmpty.displayName = "PickerEmpty";

/** Optional grouping (cmdk Group). `heading` renders the `// section` label. */
const PickerGroup = CommandPrimitive.Group;

export { PickerList, PickerEmpty, PickerGroup };
