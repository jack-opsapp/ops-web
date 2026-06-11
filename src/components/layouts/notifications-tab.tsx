"use client";

import { useEffect, useMemo } from "react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { resolveTone, toneRank } from "@/lib/notifications/notification-meta";
import { useDictionary } from "@/i18n/client";
import type { EdgeTabAccent } from "@/components/ui/edge-tab.types";
import { EDGE_RAIL_STACK } from "@/components/ui/edge-rail-layout";

const EDGE_TAB_ID = "notifications";
const RAIL = EDGE_RAIL_STACK.notifications;

export function NotificationsTab() {
  const { t } = useDictionary("notifications");
  const { data: notifs = [] } = useNotifications();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const toggle = useEdgeTabStore((s) => s.toggle);

  const count = notifs.length;

  // Compute the accent from the highest-severity outstanding notification.
  const topTone = useMemo<EdgeTabAccent>(() => {
    return notifs.reduce<EdgeTabAccent>((best, n) => {
      const tone = resolveTone(n.type);
      return toneRank[tone] > toneRank[best] ? tone : best;
    }, "ambient");
  }, [notifs]);

  const accent = useMemo<EdgeTabAccent>(() => {
    if (topTone === "critical") return "critical";
    if (topTone === "attn") return "attn";
    return "accent";
  }, [topTone]);

  // Tinted glass — when an urgent or attention notification is outstanding,
  // wash the tab in a 0.12-alpha rose glaze so the rail picks up the
  // semantic hue alongside the brighter accent stripe. (Bug 82cc08e5.)
  const tint = useMemo<"neutral" | "rose" | "accent">(() => {
    if (topTone === "critical" || topTone === "attn") return "rose";
    return "neutral";
  }, [topTone]);

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
      tint={tint}
      height={RAIL.height}
      drawerWidth={RAIL.drawerWidth}
      stackOffset={RAIL.stackOffset}
      wordmark={t("tab.wordmarkClosed")}
      wordmarkOpen={t("tab.wordmarkOpen")}
      ariaLabel={t("tab.ariaLabel")}
      shortcut="N"
      tooltipTitle={t("tab.tooltipTitle")}
      openGlyphRotation={0}
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
