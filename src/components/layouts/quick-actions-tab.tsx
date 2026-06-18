"use client";

import { useEffect, useMemo } from "react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import { useQuickActionsVisible } from "@/lib/hooks/use-quick-actions";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import { EDGE_RAIL_STACK } from "@/components/ui/edge-rail-layout";

const EDGE_TAB_ID = "quick-actions";
const RAIL = EDGE_RAIL_STACK.quickActions;

// Quick-actions DRAWER sizing — content-driven (bug dd5659ed): the panel
// grows with the visible action list instead of locking at 452.
//
//   header  = 46px (12px py + 13px Cake Mono title row)
//   row     = 36px each (8px py + 14px icon row + 6px padding)
//   list-pad= 16px (8px top + 8px bottom around the row stack)
//   footer  = 38px (CUSTOMIZE → row)
//
// Hard cap at 452 so very long action lists stay scrollable inside the
// panel rather than running off-screen on small viewports. Consumed by
// quick-actions-drawer.tsx (PANEL_H). The TAB no longer grows — fixed
// heights per the P2 shell design (§4.4).
export const QA_HEADER_H = 46;
export const QA_FOOTER_H = 38;
export const QA_ROW_H = 36;
export const QA_LIST_PADDING = 16;
export const QA_MAX_PANEL_H = 452;

export function computeQuickActionsPanelHeight(actionCount: number): number {
  const raw =
    QA_HEADER_H + QA_LIST_PADDING + actionCount * QA_ROW_H + QA_FOOTER_H;
  return Math.min(raw, QA_MAX_PANEL_H);
}

export function QuickActionsTab() {
  const { t } = useDictionary("quick-actions");
  const visible = useQuickActionsVisible();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const toggle = useEdgeTabStore((s) => s.toggle);

  // Tinted glass — when work is queued in Quick Actions (review stacks,
  // duplicate review pending), wash the tab in the tan attention glaze.
  // Earth tones only: tan = attention. Default = neutral. (Bug 82cc08e5.)
  const { data: notifs = [] } = useNotifications();
  const duplicateReviewOpen = useDuplicateReviewStore((s) => s.open);
  const tint = useMemo<"neutral" | "rose" | "tan">(() => {
    const hasReviewQueue = notifs.some(
      (n) =>
        n.type === "payment_review_stack" ||
        n.type === "task_review_stack" ||
        n.type === "unscheduled_review_stack" ||
        n.type === "duplicates_found",
    );
    if (hasReviewQueue || duplicateReviewOpen) return "tan";
    return "neutral";
  }, [notifs, duplicateReviewOpen]);

  // Keyboard shortcut: Q (no modifiers, not inside input/textarea/contenteditable)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "q") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      toggle(EDGE_TAB_ID);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  if (!visible) return null;

  return (
    <EdgeTab
      id={EDGE_TAB_ID}
      open={open}
      onToggle={() => toggle(EDGE_TAB_ID)}
      tint={tint}
      height={RAIL.height}
      drawerWidth={RAIL.drawerWidth}
      stackOffset={RAIL.stackOffset}
      wordmark={t("tab.wordmarkClosed")}
      wordmarkOpen={t("tab.wordmarkOpen")}
      ariaLabel={t("tab.ariaLabel")}
      shortcut="Q"
      tooltipTitle={t("tab.tooltipTitle")}
      renderGlyph={() => (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        >
          {/* Plus glyph; rotates 45° on open via the tab itself (becomes ×) */}
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
    />
  );
}
