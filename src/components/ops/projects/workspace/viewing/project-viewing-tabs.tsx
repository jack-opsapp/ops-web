"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// `ProjectViewingTabs` — body-level tab strip for the viewing dossier
// (Activity / Details / Accounting). Distinct from the workspace shell's
// `ModalTabs` slot which is reserved for edit/create's Identity / Schedule.
//
// Active underline uses a shared `layoutId` so Framer Motion slides the
// 1px hairline between buttons instead of fading-out + fading-in. Brand
// motion: EASE_SMOOTH · 220ms tween · no spring (per OPS spec).
//
// Reduced motion: collapses the slide to a 0ms swap. The underline still
// repositions instantly — vestibular users keep the same spatial signal
// without the lateral motion.

export type ViewingTabId = "activity" | "details" | "accounting";

export interface ViewingTab {
  id: ViewingTabId;
  label: string;
  /** When true, render disabled state (e.g. permission-gated). */
  disabled?: boolean;
}

export interface ProjectViewingTabsProps {
  tabs: ReadonlyArray<ViewingTab>;
  activeId: ViewingTabId;
  onChange: (id: ViewingTabId) => void;
  className?: string;
}

const UNDERLINE_LAYOUT_ID = "project-viewing-tabs-underline";

export function ProjectViewingTabs({
  tabs,
  activeId,
  onChange,
  className,
}: ProjectViewingTabsProps) {
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: "tween" as const, duration: 0.22, ease: EASE_SMOOTH };

  return (
    <div
      role="tablist"
      data-testid="project-viewing-tabs"
      className={cn(
        "flex items-stretch shrink-0",
        "overflow-x-auto overscroll-x-contain",
        "border-b border-glass-border bg-[var(--scrim-strip-bg)]",
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
            aria-disabled={tab.disabled || undefined}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => {
              if (!isActive && !tab.disabled) onChange(tab.id);
            }}
            className={cn(
              "relative font-mono uppercase tracking-[0.16em] text-[10.5px] leading-[1]",
              "shrink-0",
              "px-[14px] py-[11px]",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
              "select-none",
              tab.disabled
                ? "opacity-40 cursor-not-allowed text-text-3"
                : isActive
                  ? "cursor-pointer text-text"
                  : "cursor-pointer text-text-3 hover:text-text-2",
            )}
          >
            {tab.label}
            {isActive && (
              <motion.span
                layoutId={UNDERLINE_LAYOUT_ID}
                data-testid={`project-viewing-tabs-underline-${tab.id}`}
                aria-hidden="true"
                className="absolute left-0 right-0 -bottom-px h-px bg-text"
                transition={transition}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
