"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PickerSearchProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>,
    "value" | "onChange"
  > {
  value: string;
  onValueChange: (value: string) => void;
  /** aria-label for the clear button (pass an i18n string). */
  clearLabel?: string;
}

/**
 * PickerSearch — canonical search row: icon + cmdk input + clear.
 * Controlled (owns nothing; parent holds the query). Focus = accent ring.
 */
const PickerSearch = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  PickerSearchProps
>(
  (
    { className, value, onValueChange, clearLabel = "Clear search", placeholder, ...props },
    ref,
  ) => (
    <div className="m-1 flex h-8 items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 focus-within:ring-[1.5px] focus-within:ring-ops-accent focus-within:ring-offset-2 focus-within:ring-offset-black">
      <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
      <CommandPrimitive.Input
        ref={ref}
        value={value}
        onValueChange={onValueChange}
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-3",
          className,
        )}
        {...props}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label={clearLabel}
          className="shrink-0 text-text-3 transition-colors hover:text-text"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ),
);
PickerSearch.displayName = "PickerSearch";

export { PickerSearch };
