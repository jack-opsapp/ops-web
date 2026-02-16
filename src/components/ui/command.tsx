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
      "bg-background-panel text-text-primary font-mohave",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function CommandDialog({ open, onOpenChange, children }: CommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-[640px] shadow-glow-accent-lg">
        <VisuallyHidden.Root>
          <DialogTitle>Command Palette</DialogTitle>
        </VisuallyHidden.Root>
        <Command
          className={cn(
            "[&_[cmdk-group-heading]]:px-1 [&_[cmdk-group-heading]]:py-[6px]",
            "[&_[cmdk-group-heading]]:font-kosugi [&_[cmdk-group-heading]]:text-caption-sm",
            "[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:uppercase",
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
  }
>(({ className, onClear, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-2" cmdk-input-wrapper="">
    <Search className="mr-1 h-[18px] w-[18px] shrink-0 text-text-tertiary" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-7 w-full bg-transparent py-1.5",
        "font-mohave text-body text-text-primary",
        "placeholder:text-text-tertiary",
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
        className="ml-1 text-text-tertiary hover:text-text-primary transition-colors"
        aria-label="Clear search"
      >
        <X className="h-[16px] w-[16px]" />
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
      "py-4 text-center text-body-sm text-text-tertiary font-mohave",
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
      "[&_[cmdk-group-heading]]:font-kosugi [&_[cmdk-group-heading]]:text-caption-sm",
      "[&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:uppercase",
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
      "rounded-sm px-1 py-[8px]",
      "text-body-sm text-text-primary font-mohave",
      "outline-none transition-colors duration-100",
      "data-[selected=true]:bg-background-elevated data-[selected=true]:text-text-primary",
      "data-[selected=true]:shadow-[inset_2px_0_0_0_#417394]",
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
      "ml-auto text-caption-sm text-text-tertiary tracking-widest font-mono",
      "px-[6px] py-[2px] rounded-sm bg-background-elevated border border-border-subtle",
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
