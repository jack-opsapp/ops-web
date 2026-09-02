"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Shared controls for the calculator panel.
 *
 * Every value here traces to a DESIGN.md token: segments follow §9
 * "Toggles / segments" (no accent, ever), keys follow the input surface
 * ladder, and labels are the JetBrains Mono 11px tactical micro-label.
 */

/** JetBrains Mono 11px uppercase — the tactical label voice (DESIGN.md §4). */
const MICRO_LABEL = "font-mono text-micro uppercase tracking-[0.12em] text-text-3";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  /** Accessible name for the group — it has no visible heading of its own. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A chip radio group. Roving tabindex plus arrow keys, per the WAI radio
 * pattern — one tab stop for the whole group, arrows move the selection.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-0.5", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex h-[24px] flex-1 items-center justify-center rounded-chip border px-[6px]",
              "font-mono text-micro uppercase tracking-[0.12em]",
              "transition-colors duration-150 motion-reduce:transition-none",
              FOCUS_RING,
              selected
                ? "border-line-hi bg-surface-active text-text"
                : "border-line bg-transparent text-text-3 hover:text-text-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface LabeledFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps the control in its own `<label>`, so the association is implicit and
 * no generated id has to be threaded through the shared `Input`.
 */
export function LabeledField({ label, children, className }: LabeledFieldProps) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className={MICRO_LABEL}>{label}</span>
      {children}
    </label>
  );
}

/** Section heading for a group that is not a single field. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={MICRO_LABEL}>{children}</span>;
}

export const SELECT_CLASS = cn(
  "h-9 w-full min-w-0 rounded border border-line bg-surface-input px-1",
  "font-mono text-body-sm text-text-2",
  "transition-colors duration-150 motion-reduce:transition-none",
  "hover:border-line-hi",
  FOCUS_RING,
);

/** Right-aligned mono numerics — DESIGN.md §4: numbers are always mono. */
export const NUMERIC_INPUT_CLASS = "text-right font-mono text-body-sm";

interface KeypadProps {
  onAppend: (token: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  onEquals: () => void;
  labels: { clear: string; backspace: string; equals: string };
}

/** Glyphs the evaluator accepts directly — `×` and `÷` are tokenised aliases. */
const KEY_ROWS: readonly (readonly string[])[] = [
  ["(", ")"],
  ["7", "8", "9", "÷"],
  ["4", "5", "6", "×"],
  ["1", "2", "3", "-"],
  ["0", ".", "%", "+"],
];

export function Keypad({
  onAppend,
  onClear,
  onBackspace,
  onEquals,
  labels,
}: KeypadProps) {
  const keyClass = cn(
    "flex h-9 items-center justify-center rounded border border-line bg-surface-input",
    "font-mono text-body-sm text-text-2",
    "transition-colors duration-150 motion-reduce:transition-none",
    "hover:bg-surface-hover hover:text-text",
    FOCUS_RING,
  );

  return (
    <div className="grid grid-cols-4 gap-0.5">
      <button type="button" aria-label={labels.clear} onClick={onClear} className={keyClass}>
        C
      </button>
      {KEY_ROWS[0].map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onAppend(token)}
          className={keyClass}
        >
          {token}
        </button>
      ))}
      <button
        type="button"
        aria-label={labels.backspace}
        onClick={onBackspace}
        className={keyClass}
      >
        ⌫
      </button>
      {KEY_ROWS.slice(1).map((row) =>
        row.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => onAppend(token)}
            className={keyClass}
          >
            {token}
          </button>
        )),
      )}
      <button
        type="button"
        aria-label={labels.equals}
        onClick={onEquals}
        className={cn(keyClass, "col-span-4")}
      >
        =
      </button>
    </div>
  );
}
