"use client";

import { useEffect, useState } from "react";

export type ViewportBreakpoint = "mobile" | "compact" | "comfortable" | "wide";

/**
 * Inbox-specific viewport breakpoints (per the redesign spec):
 *   wide        ≥ 1600   — three columns, right rail open
 *   comfortable 1280–1599 — three columns, right rail closed by default
 *   compact     768–1279  — right rail becomes overlay drawer
 *   mobile      < 768     — single-pane stacked router
 */

export const BREAKPOINTS = {
  wide: 1600,
  comfortable: 1280,
  compact: 768,
} as const;

function classify(width: number): ViewportBreakpoint {
  if (width >= BREAKPOINTS.wide) return "wide";
  if (width >= BREAKPOINTS.comfortable) return "comfortable";
  if (width >= BREAKPOINTS.compact) return "compact";
  return "mobile";
}

export function useViewportBreakpoint(): ViewportBreakpoint {
  const [bp, setBp] = useState<ViewportBreakpoint>(() => {
    if (typeof window === "undefined") return "wide";
    return classify(window.innerWidth);
  });

  useEffect(() => {
    function update() {
      setBp(classify(window.innerWidth));
    }
    window.addEventListener("resize", update);
    update();
    return () => window.removeEventListener("resize", update);
  }, []);

  return bp;
}
