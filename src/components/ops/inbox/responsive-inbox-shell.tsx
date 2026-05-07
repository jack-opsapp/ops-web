"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { useViewportBreakpoint, type ViewportBreakpoint } from "@/lib/hooks/use-viewport-breakpoint";
import { useInboxLayoutStore } from "@/stores/inbox-layout-store";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { cn } from "@/lib/utils/cn";
import { InboxShell } from "./inbox-shell";
import {
  MobileStackedShell,
  type MobileInboxPane,
} from "./mobile-stacked-shell";

export type { ViewportBreakpoint };

export type RailMode = "docked" | "hidden" | "overlay" | "mobile";

/**
 * Pure decision: given the viewport breakpoint and the user's stored
 * rail-open preference, what mode should the rail render in?
 *
 *   wide        + open → docked
 *   wide        + closed → hidden (user explicitly toggled it shut)
 *   comfortable + open → docked (user toggled it open)
 *   comfortable + closed → hidden (default at this width)
 *   compact     + open → overlay (slide-in drawer)
 *   compact     + closed → hidden
 *   mobile      → mobile (handled by MobileStackedShell)
 */
export function effectiveRailMode(
  bp: ViewportBreakpoint,
  userOpen: boolean,
): RailMode {
  if (bp === "mobile") return "mobile";
  if (!userOpen) return "hidden";
  if (bp === "compact") return "overlay";
  return "docked";
}

interface ResponsiveInboxShellProps {
  /** Thread id — drives ContextRail re-mount + mobile pane reset. */
  threadId: string;
  /** Mobile pane state — owned by parent so URL changes can keep it in sync. */
  mobilePane?: MobileInboxPane;
  onMobilePaneChange?: (pane: MobileInboxPane) => void;
  threadList: ReactNode;
  detail: ReactNode;
  contextRail: ReactNode;
  className?: string;
}

export function ResponsiveInboxShell({
  threadId,
  mobilePane,
  onMobilePaneChange,
  threadList,
  detail,
  contextRail,
  className,
}: ResponsiveInboxShellProps) {
  const bp = useViewportBreakpoint();
  const userOpen = useInboxLayoutStore((s) => s.rightRailOpen);
  const setRightRailOpen = useInboxLayoutStore((s) => s.setRightRailOpen);
  const reduce = useReducedMotion();

  // Internal mobile pane fallback when parent doesn't manage it.
  const [internalPane, setInternalPane] = useState<MobileInboxPane>("list");
  const pane = mobilePane ?? internalPane;
  const setPane = onMobilePaneChange ?? setInternalPane;

  if (bp === "mobile") {
    return (
      <MobileStackedShell
        activePane={pane}
        onPaneChange={setPane}
        threadList={threadList}
        detail={detail}
        contextRail={contextRail}
        className={className}
      />
    );
  }

  const mode = effectiveRailMode(bp, userOpen);

  if (mode === "overlay") {
    return (
      <div className={cn("relative h-full w-full", className)}>
        <InboxShell
          threadList={threadList}
          detail={detail}
          contextRail={contextRail}
          rightRailOpen={false}
        />
        <AnimatePresence>
          <motion.div
            key={`overlay-${threadId}`}
            initial={reduce ? { opacity: 0 } : { x: 360, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 360, opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE_SMOOTH }}
            className="absolute inset-y-0 right-0 z-[1500] flex w-[360px] flex-col border-l border-line bg-inbox-bg-deep shadow-elevated"
          >
            <button
              type="button"
              onClick={() => setRightRailOpen(false)}
              aria-label="Close context drawer"
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-text-3 hover:bg-inbox-elev hover:text-text-2"
            >
              ×
            </button>
            {contextRail}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <InboxShell
      threadList={threadList}
      detail={detail}
      contextRail={contextRail}
      rightRailOpen={mode === "docked"}
      className={className}
    />
  );
}
