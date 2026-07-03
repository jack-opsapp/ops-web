import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `Segmented` — radio-group-style segmented control. Used for in-card mode
// toggles (e.g. visibility: private / team / public). Distinct from
// page-level `<Tabs>` — Tabs navigate, Segmented selects a value.
//
// Active segment gets text-text + a 1px accent-line underline; inactive
// segments stay text-3 with no underline. Single keyboard tab into the
// group, then arrow-key navigation between segments per WAI-ARIA radio
// pattern.

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Field clones id, aria-describedby, aria-invalid onto the group. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
}

export const Segmented = React.forwardRef<HTMLDivElement, SegmentedProps>(
  (
    { options, value, onChange, disabled, id, className, ...aria },
    ref,
  ) => {
    const handleKey = (e: React.KeyboardEvent) => {
      if (disabled) return;
      const idx = options.findIndex((o) => o.value === value);
      if (idx < 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = options[(idx + 1) % options.length];
        onChange(next.value);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = options[(idx - 1 + options.length) % options.length];
        onChange(prev.value);
      }
    };

    return (
      <div
        ref={ref}
        role="radiogroup"
        id={id}
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        onKeyDown={handleKey}
        className={cn(
          // 36px form-control floor (DESIGN.md § Inputs); h-8 = 64px on the
          // doubled scale — this radiogroup sits inline with 36px fields.
          "inline-flex items-stretch min-h-[36px] p-0.5 gap-0.5",
          "bg-[var(--surface-input)]",
          "rounded border border-glass-border",
          disabled && "opacity-40 pointer-events-none",
          className,
        )}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              data-active={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "inline-flex items-center justify-center px-2 min-w-[64px]",
                "font-mono uppercase tracking-[0.12em] text-[11px] leading-[1.3]",
                "rounded-bar transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                "cursor-pointer select-none focus:outline-none",
                active
                  ? "text-text bg-[var(--ops-accent-soft)] border-b border-ops-accent"
                  : "text-text-3 hover:text-text-2 border-b border-transparent",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  },
);
Segmented.displayName = "Segmented";
