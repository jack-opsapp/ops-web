"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "@/lib/utils/cn";

interface PickerItemProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>,
    "onSelect"
  > {
  /** cmdk match value — typed search filters against this. Keep unique. */
  value: string;
  /** Currently-chosen value? Renders the trailing check (single) / checked box (multi). */
  selected?: boolean;
  /** Multi-select → leading checkbox instead of a trailing check. */
  multiple?: boolean;
  onSelect?: (value: string) => void;
  /** Leading slot — avatar, status dot, or icon. */
  leading?: React.ReactNode;
  /** Second line beneath the label (e.g. a conflict advisory). */
  subLabel?: React.ReactNode;
  /** Right-aligned slot — unit abbreviation, count, chevron. */
  trailing?: React.ReactNode;
}

/**
 * PickerItem — the one canonical row. State rule (everywhere):
 *  hover → surface-hover · keyboard cursor (cmdk data-selected) → surface-active
 *  · chosen → surface-active + monochrome check · disabled → opacity-40.
 * Accent never appears here — it is reserved for the focus ring.
 */
const PickerItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  PickerItemProps
>(
  (
    {
      value,
      selected,
      multiple,
      disabled,
      onSelect,
      leading,
      subLabel,
      trailing,
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <CommandPrimitive.Item
      ref={ref}
      value={value}
      disabled={disabled}
      onSelect={() => onSelect?.(value)}
      aria-checked={multiple ? Boolean(selected) : undefined}
      data-chosen={selected ? "true" : undefined}
      className={cn(
        "flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-1.5",
        "font-mohave text-body-sm text-text-2 outline-none transition-colors duration-150",
        "hover:bg-surface-hover hover:text-text",
        "data-[selected=true]:bg-surface-active data-[selected=true]:text-text",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40",
        selected && "bg-surface-active text-text",
        className,
      )}
      {...props}
    >
      {multiple ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-chip border",
            selected ? "border-border-strong bg-surface-active" : "border-border",
          )}
        >
          {selected ? <Check className="h-3 w-3 text-text" strokeWidth={2} /> : null}
        </span>
      ) : null}
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {subLabel ? (
          <span className="truncate font-mono text-micro normal-case text-text-3">{subLabel}</span>
        ) : null}
      </span>
      {trailing}
      {!multiple && selected ? (
        <Check className="h-4 w-4 shrink-0 text-text" strokeWidth={1.5} aria-hidden="true" />
      ) : null}
    </CommandPrimitive.Item>
  ),
);
PickerItem.displayName = "PickerItem";

interface PickerFooterActionProps
  extends React.ComponentPropsWithoutRef<"button"> {
  icon?: React.ReactNode;
  destructive?: boolean;
}

/** Divided footer action — inline create / clear / remove. */
const PickerFooterAction = React.forwardRef<
  HTMLButtonElement,
  PickerFooterActionProps
>(({ icon, destructive, className, children, ...props }, ref) => (
  <div className="border-t border-border-subtle p-1">
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5",
        "font-mohave text-body-sm outline-none transition-colors duration-150",
        "hover:bg-surface-hover focus-visible:bg-surface-hover",
        destructive ? "text-rose" : "text-text-2 hover:text-text",
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 text-text-3">{icon}</span> : null}
      {children}
    </button>
  </div>
));
PickerFooterAction.displayName = "PickerFooterAction";

export { PickerItem, PickerFooterAction };
