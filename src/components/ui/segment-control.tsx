"use client";

/**
 * SegmentControl — the shared DESIGN.md §9 toggle group.
 *
 * Spec: inactive text-3 on transparent with no border; active text on
 * rgba(255,255,255,0.08) with an rgba(255,255,255,0.18) border (the spec's
 * literal active values — no named token exists for either). Toggle voice
 * is JetBrains Mono 11 tracked uppercase (DESIGN.md §4 gives Cake Mono no
 * 12px role); 28px outer / 22px items — the toolbar tier established by
 * the projects table-v2 view tabs.
 *
 * Promoted from the Books workbar (P3.1, incl. the P3-3 conformance
 * remediation). The older underline-style `ops/segmented-picker` predates
 * spec v2; the P4 conformance sweep migrates its consumers here.
 */

import { useId } from "react";
import { cn } from "@/lib/utils/cn";

export interface SegmentControlOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional right-aligned mono count. */
  count?: number;
}

type SegmentControlProps<T extends string> = {
  options: SegmentControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** Locks the control (e.g. while a mode mutation is in flight) — prevents
   *  rapid re-toggles that could race out-of-order server responses. */
  disabled?: boolean;
} & (
  | { mode?: "tabs"; ariaLabel?: string }
  | { mode: "choice"; ariaLabel: string }
);

export function SegmentControl<T extends string = string>(
  props: SegmentControlProps<T>,
) {
  const {
    options,
    value,
    onChange,
    className,
    disabled = false,
    mode = "tabs",
    ariaLabel,
  } = props;
  const generatedId = useId();
  const radioName = `segment-control-${generatedId}`;
  const rootClassName = cn(
    "inline-flex h-[28px] items-center gap-[2px] rounded border border-border p-[2px]",
    disabled && "pointer-events-none opacity-40",
    className,
  );

  if (mode === "choice") {
    return (
      <div
        className={rootClassName}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
      >
        {options.map((opt, index) => {
          const active = opt.value === value;
          const optionId = `${radioName}-${index}`;
          return (
            <span key={opt.value} className="contents">
              <input
                id={optionId}
                className="peer sr-only"
                type="radio"
                name={radioName}
                value={opt.value}
                checked={active}
                disabled={disabled}
                onChange={() => onChange(opt.value)}
              />
              <label
                htmlFor={optionId}
                className={cn(
                  "inline-flex h-[22px] cursor-pointer items-center gap-1 rounded px-1.5",
                  "font-mono text-micro font-medium uppercase tracking-[0.12em]",
                  "border transition-colors duration-150 ease-smooth",
                  active
                    ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                    : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text-2",
                  "peer-focus-visible:outline-none peer-focus-visible:ring-1 peer-focus-visible:ring-ops-accent",
                  disabled && "cursor-not-allowed",
                )}
              >
                {opt.label}
                {typeof opt.count === "number" && (
                  <span className="font-mono text-micro text-text-3 tabular-nums">
                    {opt.count}
                  </span>
                )}
              </label>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={rootClassName}
      role="tablist"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded px-1.5",
              // Toggle voice: JetBrains Mono 11px uppercase — Cake Mono has
              // no 12px role (DESIGN.md §4: 14 button / 11 badge only).
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              "border transition-colors duration-150 ease-smooth",
              active
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text-2",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
            )}
          >
            {opt.label}
            {typeof opt.count === "number" && (
              <span className="font-mono text-micro text-text-3 tabular-nums">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
