"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// `ModalTabs` — workspace tab strip for the dossier (Activity / Details
// / Accounting) and the edit/create form (Identity / Schedule). Active
// tab gets a 1px bottom hairline in --text; inactive tabs render text-3
// with no underline.
//
// Phase 12.4 — the active underline uses a shared `layoutId` so Framer
// Motion slides the 1px hairline between buttons over 220ms EASE_SMOOTH
// instead of fading-out + fading-in. Reduced motion collapses the slide
// to a 0ms swap (the underline still repositions instantly so vestibular
// users keep the same spatial signal without the lateral motion).
//
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

const UNDERLINE_LAYOUT_ID = "modal-tabs-underline";

export function ModalTabs<TId extends string>({
  tabs,
  activeId,
  onChange,
  className,
}: ModalTabsProps<TId>) {
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: "tween" as const, duration: 0.22, ease: EASE_SMOOTH };

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
              "relative font-mono uppercase tracking-[0.16em] text-[10.5px] leading-[1]",
              "px-[14px] py-[11px]",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
              "cursor-pointer select-none",
              isActive
                ? "text-text"
                : "text-text-3 hover:text-text-2",
            )}
          >
            {tab.label}
            {isActive && (
              <motion.span
                layoutId={UNDERLINE_LAYOUT_ID}
                data-testid={`modal-tabs-underline-${tab.id}`}
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
