"use client";

import { useEffect, useMemo } from "react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { resolveTone, toneRank } from "@/lib/notifications/notification-meta";
import { useDictionary } from "@/i18n/client";
import type { EdgeTabAccent } from "@/components/ui/edge-tab.types";

const EDGE_TAB_ID = "notifications";
// Combined-stack math: Notifications (180px) above gap (8px) above FAB (132px),
// gap centered on drawer-area midpoint. Notif center = -4px - 90px = -94px.
const STACK_OFFSET_NOTIF = -94;

export function NotificationsTab() {
  const { t } = useDictionary("notifications");
  const { data: notifs = [] } = useNotifications();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
  const toggle = useEdgeTabStore((s) => s.toggle);

  const count = notifs.length;

  // Compute the accent from the highest-severity outstanding notification.
  const accent = useMemo<EdgeTabAccent>(() => {
    const topTone = notifs.reduce<EdgeTabAccent>((best, n) => {
      const tone = resolveTone(n.type);
      return toneRank[tone] > toneRank[best] ? tone : best;
    }, "ambient");
    if (topTone === "critical") return "critical";
    if (topTone === "attn") return "attn";
    return "accent";
  }, [notifs]);

  // Keyboard shortcut: N (no modifiers, not inside input/textarea/contenteditable)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "n") return;
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

  return (
    <EdgeTab
      id={EDGE_TAB_ID}
      open={open}
      onToggle={() => toggle(EDGE_TAB_ID)}
      count={count}
      accent={accent}
      restHeight={180}
      drawerWidth={360}
      stackOffset={STACK_OFFSET_NOTIF}
      canHoverExpand={!anyActive || open}
      wordmark={t("tab.wordmarkClosed")}
      wordmarkOpen={t("tab.wordmarkOpen")}
      ariaLabel={t("tab.ariaLabel")}
      shortcut="N"
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
          {isOpen ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </>
          )}
        </svg>
      )}
    />
  );
}
