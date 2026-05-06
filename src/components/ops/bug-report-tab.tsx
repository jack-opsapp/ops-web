"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bug } from "lucide-react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import { useBugReportStore } from "@/stores/bug-report-store";

export const EDGE_TAB_ID_BUG = "bug-report";

// ─── Stack math (right rail) ───────────────────────────────────────────────
// Notifications restHeight = 180, stackOffset = -94 (above mid).
// QuickActions  restHeight = 132, stackOffset = +94 (below mid).
// BugReport     restHeight = 100, stackOffset = +218 (below QA with 8px gap).
//
// Derivation:
//   QA bottom edge at rest = +94 + 132/2 = +160
//   Gap between QA and Bug = 8
//   Bug top edge at rest    = +160 + 8 = +168
//   Bug center at rest      = +168 + 100/2 = +218
//
// The +218 places the Bug tab 168px below the rail midpoint, with its 100px
// rest height ending at +268 (still well above the railBottom default of 16
// on viewports ≥ 600px; on shorter viewports the EdgeTab maxHeight clamp
// keeps everything visible).
export const STACK_OFFSET_BUG = 218;
const REST_HEIGHT = 100;
const DRAWER_WIDTH = 360;
// Drawer panel is content-driven — power user sees full triage controls,
// minimal user sees a single textarea + submit. Cap matches the right-rail
// height budget on a 1280×800 viewport.
const EXPANDED_HEIGHT = 520;

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
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
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
      restHeight={REST_HEIGHT}
      expandedHeight={EXPANDED_HEIGHT}
      drawerWidth={DRAWER_WIDTH}
      stackOffset={STACK_OFFSET_BUG}
      canHoverExpand={!anyActive || open}
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
