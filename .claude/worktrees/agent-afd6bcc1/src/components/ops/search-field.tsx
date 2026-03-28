"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string;
  onChange?: (value: string) => void;
  debounceMs?: number;
}

const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ className, value: controlledValue, onChange, debounceMs = 300, placeholder = "Search...", ...props }, ref) => {
    const [internalValue, setInternalValue] = React.useState(controlledValue ?? "");
    const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Sync controlled value
    React.useEffect(() => {
      if (controlledValue !== undefined) {
        setInternalValue(controlledValue);
      }
    }, [controlledValue]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const val = e.target.value;
      setInternalValue(val);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange?.(val);
      }, debounceMs);
    }

    function handleClear() {
      setInternalValue("");
      onChange?.("");
      // Focus input after clear
      if (inputRef.current) inputRef.current.focus();
    }

    // Merge refs
    const mergedRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      },
      [ref]
    );

    // Cleanup debounce on unmount
    React.useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    return (
      <div className={cn("relative", className)}>
        <Search
          className="absolute left-1.5 top-1/2 -translate-y-1/2 h-[16px] w-[16px] text-text-tertiary pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={mergedRef}
          type="text"
          value={internalValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={cn(
            "w-full bg-background-input text-text-primary font-mohave text-body",
            "pl-5 pr-5 py-1.5 rounded-lg",
            "border border-border",
            "transition-all duration-150",
            "placeholder:text-text-tertiary",
            "focus:border-ops-accent focus:outline-none focus:shadow-glow-accent"
          )}
          aria-label={placeholder}
          {...props}
        />
        {internalValue && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2",
              "text-text-tertiary hover:text-text-primary",
              "transition-colors duration-150",
              "p-[2px] rounded-sm"
            )}
            aria-label="Clear search"
          >
            <X className="h-[14px] w-[14px]" />
          </button>
        )}
      </div>
    );
  }
);
SearchField.displayName = "SearchField";

export { SearchField };
