"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Universal compact search input — matches the styling first established
 * in the calendar's unscheduled tray:
 *
 *   - 11px font-mono uppercase tracking-[0.06em]
 *   - Search icon at left (12px)
 *   - surface-input background, hairline border (var(--line))
 *   - 5px radius
 *   - Border lifts to rgba(255,255,255,0.20) on focus
 *
 * Use this anywhere a calendar / dashboard / drawer needs a tactical
 * search field. Avoid the heavier `Input` primitive (56px tall) for
 * inline filter contexts.
 */

export interface SearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Icon size (px). Defaults to 12 to match the unscheduled tray. */
  iconSize?: number;
  /** Wrapper className — applies to the relative container, not the input. */
  wrapperClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      iconSize = 12,
      wrapperClassName,
      className,
      placeholder = "SEARCH",
      ...props
    },
    ref
  ) => {
    return (
      <div className={cn("relative", wrapperClassName)}>
        <Search
          size={iconSize}
          className="absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none text-text-3"
        />
        <input
          ref={ref}
          type="text"
          placeholder={placeholder}
          className={cn(
            "w-full pl-[30px] pr-2 py-[6px] font-mono text-[11px] uppercase tracking-[0.06em]",
            "rounded border border-line bg-surface-input text-text outline-none",
            "transition-colors duration-150",
            // Focus border matches the Input primitive's focus-within treatment.
            "focus:border-[rgba(255,255,255,0.20)]",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

SearchInput.displayName = "SearchInput";
