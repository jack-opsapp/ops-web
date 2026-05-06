"use client";

import { useEffect, useMemo } from "react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import {
  useQuickActions,
  useQuickActionsVisible,
} from "@/lib/hooks/use-quick-actions";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";

const EDGE_TAB_ID = "quick-actions";
// Combined-stack math: Notifications (180) above gap (8) above Quick Actions (132).
// QA center sits +94 below the rail midpoint (mirror of notif at -94).
const STACK_OFFSET_QA = 94;
const REST_HEIGHT = 132;
const DRAWER_WIDTH = 308;

// Quick-actions menu sizing — content-driven (bug dd5659ed). The panel
// height grows with the action list rather than locking at 452.
//
//   header  = 46px (12px py + 13px Cake Mono title row)
//   row     = 36px each (8px py + 14px icon row + 6px padding)
//   list-pad= 16px (8px top + 8px bottom around the row stack)
//   footer  = 38px (CUSTOMIZE → row)
//
// Hard cap at 452 so very long action lists stay scrollable inside the
// panel rather than running off-screen on small viewports. Matched
// exactly in quick-actions-drawer.tsx (PANEL_H = computeMenuHeight(...)).
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
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
  const toggle = useEdgeTabStore((s) => s.toggle);

  // Tinted glass — when there's a primary CTA queued in Quick Actions
  // (review stacks, duplicate review pending), wash the tab in a 0.12-alpha
  // accent glaze. Default = neutral. (Bug 82cc08e5.)
  const { data: notifs = [] } = useNotifications();
  const duplicateReviewOpen = useDuplicateReviewStore((s) => s.open);
  const tint = useMemo<"neutral" | "rose" | "accent">(() => {
    const hasReviewQueue = notifs.some(
      (n) =>
        n.type === "payment_review_stack" ||
        n.type === "task_review_stack" ||
        n.type === "unscheduled_review_stack" ||
        n.type === "duplicates_found",
    );
    if (hasReviewQueue || duplicateReviewOpen) return "accent";
    return "neutral";
  }, [notifs, duplicateReviewOpen]);

  // Content-driven expanded height (bug dd5659ed) — the tab + panel grow
  // exactly to fit the visible action list, never locking at 452. Capped
  // at QA_MAX_PANEL_H so very long lists stay scrollable.
  const actions = useQuickActions();
  const expandedHeight = useMemo(
    () => computeQuickActionsPanelHeight(actions.length),
    [actions.length],
  );

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
      accent="accent"
      tint={tint}
      restHeight={REST_HEIGHT}
      expandedHeight={expandedHeight}
      drawerWidth={DRAWER_WIDTH}
      stackOffset={STACK_OFFSET_QA}
      canHoverExpand={!anyActive || open}
      wordmark={t("tab.wordmarkClosed")}
      wordmarkOpen={t("tab.wordmarkOpen")}
      ariaLabel={t("tab.ariaLabel")}
      shortcut="Q"
      tooltipTitle={t("tab.tooltipTitle")}
      renderGlyph={(isOpen) => (
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
