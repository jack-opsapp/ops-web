"use client";

import { useEffect } from "react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDictionary } from "@/i18n/client";
import { useQuickActionsVisible } from "@/lib/hooks/use-quick-actions";

const EDGE_TAB_ID = "quick-actions";
// Combined-stack math: Notifications (180) above gap (8) above Quick Actions (132).
// QA center sits +94 below the rail midpoint (mirror of notif at -94).
const STACK_OFFSET_QA = 94;
const REST_HEIGHT = 132;
const DRAWER_WIDTH = 308;

export function QuickActionsTab() {
  const { t } = useDictionary("quick-actions");
  const visible = useQuickActionsVisible();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
  const toggle = useEdgeTabStore((s) => s.toggle);

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
      restHeight={REST_HEIGHT}
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
