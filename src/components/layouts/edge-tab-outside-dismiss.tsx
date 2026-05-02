"use client";

import { useEffect } from "react";
import { useEdgeTabStore } from "@/stores/edge-tab-store";

/**
 * Global outside-click dismiss for the right-rail edge-tab system
 * (Notifications, Quick Actions, Bug Report).
 *
 * Bug-5b653c30: drawers stayed open until the user explicitly clicked their
 * close button or pressed Escape. Mounting this once in DashboardLayout
 * gives all three drawers a single, consistent dismiss-on-outside-click
 * behavior.
 *
 * Rules:
 *   - Only fires while a tab is active (no work on every page click).
 *   - mousedown is the canonical outside-click trigger — fires before any
 *     inner click handlers, so a click inside a popover/menu opened from
 *     a drawer still counts as inside-the-drawer (because that menu is
 *     portaled OR contained within data-edge-tab-drawer).
 *   - "Inside" means: anywhere within a `[data-edge-tab]` (the tab itself),
 *     `[data-edge-tab-anchor]` (its rail wrapper), or
 *     `[data-edge-tab-drawer]` (the drawer/panel root).
 *   - Portaled overlays from drawer content (e.g. Radix popovers, the
 *     SetupInterceptionModal opened from Quick Actions) live OUTSIDE the
 *     DOM subtree of the drawer. To avoid dismissing the drawer when the
 *     user interacts with one of those, we also treat clicks inside any
 *     `[role="dialog"]` / `[role="menu"]` / `[role="listbox"]` as inside.
 *     That keeps the user's mental model intact: only clicking the page
 *     canvas itself dismisses.
 */
export function EdgeTabOutsideDismiss() {
  const activeTab = useEdgeTabStore((s) => s.activeTab);
  const closeAll = useEdgeTabStore((s) => s.closeAll);

  useEffect(() => {
    if (!activeTab) return;

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target || !(target instanceof Element)) return;

      // Click landed inside the active edge-tab system or any portaled
      // overlay launched from it — keep the drawer open.
      if (
        target.closest("[data-edge-tab]") ||
        target.closest("[data-edge-tab-anchor]") ||
        target.closest("[data-edge-tab-drawer]") ||
        target.closest('[role="dialog"]') ||
        target.closest('[role="menu"]') ||
        target.closest('[role="listbox"]') ||
        target.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }

      closeAll();
    }

    // mousedown beats click — close before any nested click handler runs.
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [activeTab, closeAll]);

  return null;
}
