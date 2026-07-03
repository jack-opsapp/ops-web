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
 * Controlled (owns nothing; parent holds the query). Focus = the Inputs-spec
 * border brighten (no accent — spec §340).
 */
const PickerSearch = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  PickerSearchProps
>(
  (
    { className, value, onValueChange, clearLabel = "Clear search", placeholder, ...props },
    ref,
  ) => (
    // Real px, not scale tokens — the doubled spacing scale (h-8 = 64px)
    // inflated this row to 64px; the kit's contract is a compact ~32px
    // desktop search row (see picker-item.tsx, same correction).
    // Focus is the Inputs-spec border-brighten (§340: "no accent") — the
    // accent ring belongs to buttons/CTAs, never text fields.
    <div className="m-[4px] flex h-[32px] items-center gap-[8px] rounded-[5px] border border-border bg-surface-input px-[8px] transition-colors focus-within:border-line-hi">
      <Search className="h-[16px] w-[16px] shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
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
          <X className="h-[14px] w-[14px]" strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  ),
);
PickerSearch.displayName = "PickerSearch";

export { PickerSearch };
