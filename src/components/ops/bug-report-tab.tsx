"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import { useBugReportStore } from "@/stores/bug-report-store";

export const EDGE_TAB_ID_BUG = "bug-report";

// Rail geometry comes from the shared EDGE_RAIL_STACK (single source for
// all three tabs — the per-file stack math this replaced had drifted from
// the sibling tabs' real offsets). Re-exported for the drawer, which
// anchors its panel on the same center.
import { EDGE_RAIL_STACK } from "@/components/ui/edge-rail-layout";

const RAIL = EDGE_RAIL_STACK.bugReport;
export const STACK_OFFSET_BUG = RAIL.stackOffset;

/**
 * Bug-report tab (bug b842f0ff). Lives at the BOTTOM of the right-rail edge
 * stack — below Notifications and Quick Actions. Replaces the previous
 * free-floating bottom-left button so:
 *   - The bug-report affordance is consistent with other system tabs.
 *   - The dashboard map filter rail (bottom-left) no longer collides with
 *     it on /dashboard.
 *
 * The popover form lives in `BugReportDrawer` — same single-slot mutex as
 * Notifications / QuickActions via `useEdgeTabStore`.
 */
export function BugReportTab() {
  const { t } = useDictionary("common");
  const pathname = usePathname();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID_BUG);
  const toggle = useEdgeTabStore((s) => s.toggle);

  // Keyboard shortcut — backtick (`). Avoids letter collisions with the
  // existing N (notifications) / Q (quick actions) shortcuts and stays
  // single-press for tactile feel. Same input/textarea/contenteditable
  // guards as the other tabs.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "`") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      // Capture screenshot BEFORE the drawer mounts (mirrors the legacy
      // bug-report button behavior so the image reflects what the operator
      // was looking at when they pressed the shortcut).
      useBugReportStore.getState().requestScreenshot();
      toggle(EDGE_TAB_ID_BUG);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  // Hide on routes that own the full-bleed canvas (dashboard map, intel).
  // Both routes already have edge-anchored controls that would compete with
  // the bug tab, and the previous floating button was hidden on these
  // routes for the same reason.
  if (pathname === "/dashboard" || pathname === "/intel") return null;

  const handleToggle = () => {
    // When opening, queue a fresh screenshot request — captured by the
    // drawer once it mounts. Skip on close (no point capturing the
    // closing transition).
    if (!open) {
      useBugReportStore.getState().requestScreenshot();
    }
    toggle(EDGE_TAB_ID_BUG);
  };

  return (
    <EdgeTab
      id={EDGE_TAB_ID_BUG}
      open={open}
      onToggle={handleToggle}
      accent="ambient"
      height={RAIL.height}
      drawerWidth={RAIL.drawerWidth}
      stackOffset={RAIL.stackOffset}
      openGlyphRotation={0}
      wordmark={t("bugReport.tabWordmarkClosed") ?? "REPORT"}
      wordmarkOpen={t("bugReport.tabWordmarkOpen") ?? "CLOSE"}
      ariaLabel={t("bugReport.title") ?? "Report a bug"}
      shortcut="`"
      tooltipTitle={t("bugReport.title") ?? "Report a bug"}
      renderGlyph={(isOpen) =>
        isOpen ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <Bug
            className="w-[14px] h-[14px]"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        )
      }
    />
  );
}
