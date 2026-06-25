"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { DetailTabId } from "./pipeline-mode-types";
import { usePipelineModeStore } from "./pipeline-mode-store";

const TABS: DetailTabId[] = ["overview", "correspondence", "timeline", "photos"];

const TAB_KEYS: Record<DetailTabId, string> = {
  overview: "detail.tabOverview",
  correspondence: "detail.tabCorrespondence",
  timeline: "detail.tabTimeline",
  photos: "detail.tabPhotos",
};

export function PipelineDetailTabBar() {
  const { t } = useDictionary("pipeline");
  const activeTab = usePipelineModeStore((s) => s.detailPanelActiveTab);
  const setActiveTab = usePipelineModeStore((s) => s.setDetailPanelActiveTab);

  return (
    <div className="flex shrink-0 items-center border-b border-border-subtle">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          aria-pressed={tab === activeTab}
          onClick={() => setActiveTab(tab)}
          className={cn(
            "relative px-3 py-2 font-mohave text-[11px] uppercase transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
            tab === activeTab
              ? "text-text"
              : "text-text-mute hover:text-text-2"
          )}
        >
          {t(TAB_KEYS[tab])}
          {tab === activeTab && (
            <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-2" />
          )}
        </button>
      ))}
    </div>
  );
}
