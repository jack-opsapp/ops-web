/**
 * OPS Web — useScreenView Hook
 *
 * Fires a screen_view analytics event on mount (with optional properties)
 * and records duration_ms on unmount. Uses usePathname() to derive the
 * screen name from the current route when no explicit name is provided.
 *
 * Usage:
 *   // Automatic — screen name derived from pathname
 *   useScreenView();
 *
 *   // Explicit — screen name + properties
 *   useScreenView("pipeline", { segment: "board" });
 */
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { analyticsService } from "@/lib/analytics/analytics-service";

/**
 * Derive a snake_case screen name from a Next.js pathname.
 * "/pipeline/board" → "pipeline_board"
 * "/projects/[id]"  → "projects"  (strips dynamic segments)
 * "/"               → "home"
 */
function pathnameToScreenName(pathname: string): string {
  if (pathname === "/") return "home";

  return pathname
    .replace(/^\//, "") // strip leading slash
    .replace(/\/[0-9a-f-]{20,}/g, "") // strip UUID-like dynamic segments
    .replace(/\//g, "_") // slashes → underscores
    .replace(/_+$/, "") // strip trailing underscores
    || "home";
}

export function useScreenView(
  screenName?: string,
  properties: Record<string, unknown> = {}
): void {
  const pathname = usePathname();
  const mountTimeRef = useRef<number>(0);
  const screenNameRef = useRef<string>("");

  useEffect(() => {
    if (!analyticsService) return;

    const name = screenName ?? pathnameToScreenName(pathname);
    screenNameRef.current = name;
    mountTimeRef.current = Date.now();

    analyticsService.track("screen_view", name, properties);

    return () => {
      const durationMs = Date.now() - mountTimeRef.current;
      if (durationMs > 0 && screenNameRef.current) {
        analyticsService.track(
          "screen_view",
          screenNameRef.current,
          { ...properties, ended: true },
          durationMs
        );
      }
    };
    // Only fire on mount/unmount — not on property changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
}
