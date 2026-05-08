"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

// `ModalTabs` — workspace tab strip for the dossier (Activity / Details
// / Accounting) and the edit/create form (Identity / Schedule). Active
// tab gets a 1px bottom border in --text; inactive tabs render text-3
// with a transparent border so the active underline is the sole signal.
// Strip lives below the title bar and above the body — bg is
// --scrim-strip-bg (0.18, consolidated from 0.20 per design-token
// mapping 2026-05-07), a darker glass underlay so the underline reads
// against the dense glass surface; bottom border in glass-border.

export interface ModalTab<TId extends string = string> {
  id: TId;
  label: string;
}

export interface ModalTabsProps<TId extends string = string> {
  tabs: ReadonlyArray<ModalTab<TId>>;
  activeId: TId;
  onChange: (id: TId) => void;
  className?: string;
}

export function ModalTabs<TId extends string>({
  tabs,
  activeId,
  onChange,
  className,
}: ModalTabsProps<TId>) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-stretch",
        "bg-[var(--scrim-strip-bg)]",
        "border-b border-glass-border",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => {
              if (!isActive) onChange(tab.id);
            }}
            className={cn(
              // Mono 10.5px tracking 0.16em uppercase — handoff spec.
              "font-mono uppercase tracking-[0.16em] text-[10.5px] leading-[1]",
              "px-[14px] py-[11px]",
              // 1px bottom border for both states; the colour swap is
              // the underline. -mb-px so the active underline overlaps
              // the strip's own bottom border (single hairline reads).
              "border-b -mb-px",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
              "cursor-pointer select-none",
              isActive
                ? "text-text border-b-[var(--text)]"
                : "text-text-3 border-b-transparent hover:text-text-2",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
