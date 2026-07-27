"use client";

import { useEffect } from "react";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { DetailTabId } from "./pipeline-mode-types";
import { usePipelineModeStore } from "./pipeline-mode-store";

const TABS: DetailTabId[] = [
  "overview",
  "correspondence",
  "timeline",
  "photos",
];

const TAB_KEYS: Record<DetailTabId, string> = {
  overview: "detail.tabOverview",
  correspondence: "detail.tabCorrespondence",
  timeline: "detail.tabTimeline",
  photos: "detail.tabPhotos",
  files: "detail.tabFiles",
};

export function PipelineDetailTabBar({
  hasFiles = false,
}: {
  hasFiles?: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const activeTab = usePipelineModeStore((s) => s.detailPanelActiveTab);
  const setActiveTab = usePipelineModeStore((s) => s.setDetailPanelActiveTab);
  const visibleTabs = hasFiles ? [...TABS, "files" as const] : TABS;

  useEffect(() => {
    if (!hasFiles && activeTab === "files") {
      setActiveTab("overview");
    }
  }, [activeTab, hasFiles, setActiveTab]);

  return (
    <div className="flex shrink-0 items-center border-b border-border-subtle">
      {visibleTabs.map((tab) => (
        <button
          key={tab}
          type="button"
          aria-pressed={tab === activeTab}
          onClick={() => setActiveTab(tab)}
          className={cn(
            "relative min-h-11 px-3 py-2 font-mohave text-micro uppercase transition-colors duration-150 ease-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent motion-reduce:transition-none",
            tab === activeTab ? "text-text" : "text-text-mute hover:text-text-2"
          )}
        >
          {t(TAB_KEYS[tab])}
          {tab === activeTab && (
            <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-text-2" />
          )}
        </button>
      ))}
    </div>
  );
}
