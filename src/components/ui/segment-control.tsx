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

import { cn } from "@/lib/utils/cn";

export interface SegmentControlOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional right-aligned mono count. */
  count?: number;
}

export function SegmentControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-[28px] items-center gap-[2px] rounded-[5px] border border-border p-[2px]",
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5",
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
