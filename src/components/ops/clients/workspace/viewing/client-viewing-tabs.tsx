"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// `ClientViewingTabs` — body-level tab strip for the client dossier
// (Direction B: CONTACT / PROJECTS / MONEY / ACTIVITY). Sibling of the
// project workspace's `ProjectViewingTabs`; carries its OWN layoutId so the
// two underlines never cross-animate if both windows are open at once.
//
// Brand motion: EASE_SMOOTH · 220ms tween · no spring. Reduced motion
// collapses the slide to an instant reposition (same spatial signal, no
// lateral motion).

export type ClientViewingTabId = "contact" | "projects" | "money" | "activity";

export interface ClientViewingTab {
  id: ClientViewingTabId;
  label: string;
  disabled?: boolean;
}

export interface ClientViewingTabsProps {
  tabs: ReadonlyArray<ClientViewingTab>;
  activeId: ClientViewingTabId;
  onChange: (id: ClientViewingTabId) => void;
  className?: string;
}

const UNDERLINE_LAYOUT_ID = "client-viewing-tabs-underline";

export function ClientViewingTabs({
  tabs,
  activeId,
  onChange,
  className,
}: ClientViewingTabsProps) {
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: "tween" as const, duration: 0.22, ease: EASE_SMOOTH };

  return (
    <div
      role="tablist"
      data-testid="client-viewing-tabs"
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
              "shrink-0 px-[14px] py-[11px]",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
              "select-none",
              tab.disabled
                ? "cursor-not-allowed text-text-3 opacity-40"
                : isActive
                  ? "cursor-pointer text-text"
                  : "cursor-pointer text-text-3 hover:text-text-2",
            )}
          >
            {tab.label}
            {isActive && (
              <motion.span
                layoutId={UNDERLINE_LAYOUT_ID}
                data-testid={`client-viewing-tabs-underline-${tab.id}`}
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
