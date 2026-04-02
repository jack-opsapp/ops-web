"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useReducedMotion } from "./use-reduced-motion";
import { WIDGET_EASE_CSS, WIDGET_COLLAPSE_DURATION } from "./widget-motion";

interface WidgetHeroCollapseProps {
  children: ReactNode;
  /** Whether the hero section is in collapsed state */
  collapsed: boolean;
  /** Height when collapsed (CSS value — e.g. "48px", "30%") */
  collapsedHeight?: string;
  /** Height when expanded — must be larger than any content will ever be */
  expandedHeight?: string;
  className?: string;
}

/** Collapsible hero section that shrinks when the list below expands */
export function WidgetHeroCollapse({
  children,
  collapsed,
  collapsedHeight = "48px",
  expandedHeight = "1000px",
  className,
}: WidgetHeroCollapseProps) {
  const reducedMotion = useReducedMotion();

  const transition = reducedMotion
    ? "none"
    : `max-height ${WIDGET_COLLAPSE_DURATION}ms ${WIDGET_EASE_CSS}, opacity ${WIDGET_COLLAPSE_DURATION}ms ${WIDGET_EASE_CSS}`;

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{
        maxHeight: collapsed ? collapsedHeight : expandedHeight,
        opacity: collapsed ? 0.6 : 1,
        transition,
      }}
    >
      {children}
    </div>
  );
}
