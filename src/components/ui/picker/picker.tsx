"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";

/**
 * Picker — the canonical OPS popover-select shell.
 *
 * Composition: Radix Popover (reuses the shipped `.glass-dense` PopoverContent
 * + `anchored-in` entrance, which is already reduced-motion aware) wrapping a
 * cmdk Command for search + keyboard navigation. Every concrete picker
 * (EntityPicker, EnumPicker, DatetimePicker) is built from this shell plus the
 * sibling primitives — never hand-rolled divs or portals.
 *
 * Values trace to tokens only (see `.interface-design/system.md`). Rows are
 * compact ~32px — OPS Web is cursor-driven; there is no touch-size minimum.
 */

const Picker = Popover;
const PickerTrigger = PopoverTrigger;
const PickerAnchor = PopoverAnchor;

const SIZE_WIDTH: Record<"sm" | "md" | "lg", string> = {
  sm: "w-56", // 224px
  md: "w-64", // 256px
  lg: "w-72", // 288px
};

/** cmdk group headings → `// section` micro-label. */
const GROUP_HEADING = cn(
  "[&_[cmdk-group-heading]]:px-2",
  "[&_[cmdk-group-heading]]:pb-1",
  "[&_[cmdk-group-heading]]:pt-2",
  "[&_[cmdk-group-heading]]:font-mono",
  "[&_[cmdk-group-heading]]:text-micro",
  "[&_[cmdk-group-heading]]:uppercase",
  "[&_[cmdk-group-heading]]:tracking-wider",
  "[&_[cmdk-group-heading]]:text-text-3",
);

interface PickerContentProps
  extends React.ComponentPropsWithoutRef<typeof PopoverContent> {
  /** Preset width. `auto` sizes to content. Default `md`. */
  size?: "sm" | "md" | "lg" | "auto";
  /** Explicit pixel width (overrides `size`). */
  width?: number;
  /** Accessible name for the popover. */
  label?: string;
  /** Let cmdk filter items by typed search. Default `true`. */
  shouldFilter?: boolean;
  /** Wrap keyboard cursor at the ends. Default `true`. */
  loop?: boolean;
}

const PickerContent = React.forwardRef<
  React.ElementRef<typeof PopoverContent>,
  PickerContentProps
>(
  (
    {
      size = "md",
      width,
      label,
      shouldFilter = true,
      loop = true,
      align = "start",
      sideOffset = 6,
      className,
      style,
      children,
      ...props
    },
    ref,
  ) => (
    <PopoverContent
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      role="dialog"
      aria-label={label}
      className={cn(
        "overflow-hidden p-0",
        size !== "auto" && SIZE_WIDTH[size],
        className,
      )}
      style={width ? { ...style, width } : style}
      {...props}
    >
      <CommandPrimitive
        label={label}
        shouldFilter={shouldFilter}
        loop={loop}
        className={cn("flex w-full flex-col", GROUP_HEADING)}
      >
        {children}
      </CommandPrimitive>
    </PopoverContent>
  ),
);
PickerContent.displayName = "PickerContent";

export { Picker, PickerTrigger, PickerAnchor, PickerContent };
