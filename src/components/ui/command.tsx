"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

const Command = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden",
      "bg-glass glass-surface text-text font-mohave",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Scoring override for the whole palette. cmdk re-sorts every `[cmdk-item]`
   * in a group by this score on each keystroke — `forceMount` rows included —
   * so a surface that renders server-ranked rows has to hand back a constant
   * score for them or watch its ranking get shuffled by fuzzy matching.
   */
  filter?: React.ComponentPropsWithoutRef<typeof CommandPrimitive>["filter"];
  /**
   * The highlighted item, by cmdk value — controlled.
   *
   * cmdk anchors the highlight the instant the search text changes and, for
   * `forceMount` rows, never looks again: nothing re-runs `selectFirstItem`
   * when they arrive. A surface whose rows land a round trip after the
   * keystroke therefore has to name the row itself. `undefined` hands the
   * choice back to cmdk's own first-item default.
   */
  value?: string;
  /** cmdk's own moves — ArrowDown/ArrowUp, hover, its first-item anchor. */
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

function CommandDialog({
  open,
  onOpenChange,
  filter,
  value,
  onValueChange,
  children,
}: CommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 max-w-[640px]"
        hideClose
        data-bug-report-ignore="true"
      >
        <VisuallyHidden.Root>
          <DialogTitle>Command Palette</DialogTitle>
        </VisuallyHidden.Root>
        <Command
          filter={filter}
          value={value}
          onValueChange={onValueChange}
          className={cn(
            "[&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-[6px]",
            "[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-caption-sm",
            "[&_[cmdk-group-heading]]:text-text-3 [&_[cmdk-group-heading]]:uppercase",
            "[&_[cmdk-group-heading]]:tracking-widest"
          )}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

const CommandInput = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
    onClear?: () => void;
    /**
     * A query is in flight. The glyph recedes rather than spinning — the
     * operator asked a question, not started a job, and a spinner would make a
     * 150 ms round trip feel like work. Ambient by design: felt, not watched.
     */
    searching?: boolean;
  }
>(({ className, onClear, searching = false, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-2" cmdk-input-wrapper="">
    <Search
      aria-hidden="true"
      data-searching={searching ? "true" : "false"}
      className={cn(
        "mr-1 h-icon-16 w-icon-16 shrink-0",
        // 200ms on the single OPS curve (`ease-smooth`). Reduced motion keeps
        // the state change and drops only the tween.
        "transition-colors duration-200 ease-smooth motion-reduce:transition-none",
        searching ? "text-text-mute" : "text-text-3",
      )}
    />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-7 w-full bg-transparent py-1.5",
        "font-mohave text-body text-text",
        "placeholder:text-text-3",
        "outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
    {onClear && (
      <button
        type="button"
        onClick={onClear}
        className="ml-1 text-text-3 hover:text-text transition-colors"
        aria-label="Clear search"
      >
        <X className="h-icon-16 w-icon-16" />
      </button>
    )}
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[400px] overflow-y-auto overflow-x-hidden p-0.5", className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn(
      // Left-aligned: DESIGN.md allows no centred text anywhere in the product.
      "px-1 py-2 text-left text-body-sm text-text-3 font-mohave",
      className
    )}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden py-0.5",
      "[&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-[6px]",
      "[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-caption-sm",
      "[&_[cmdk-group-heading]]:text-text-3 [&_[cmdk-group-heading]]:uppercase",
      "[&_[cmdk-group-heading]]:tracking-widest",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-0.5 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ComponentRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-1",
      "rounded-chip px-1 py-1",
      "text-body-sm text-text font-mohave",
      "outline-none transition-colors duration-100",
      "data-[selected=true]:bg-surface-input data-[selected=true]:text-text",
      "data-[selected=true]:shadow-[inset_2px_0_0_0_theme(colors.text.2)]",
      "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    className={cn(
      "ml-auto text-caption-sm text-text-3 tracking-widest font-mono",
      "px-[6px] py-[2px] rounded-sm bg-fill-neutral-dim border border-border-subtle",
      className
    )}
    {...props}
  />
);
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
