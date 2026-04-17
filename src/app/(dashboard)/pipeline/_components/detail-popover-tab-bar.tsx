"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useDetailPopoverStore, type PopoverTab } from "./detail-popover-store";

const TABS: PopoverTab[] = ["correspondence", "timeline", "photos"];

const TAB_KEYS: Record<PopoverTab, string> = {
  correspondence: "detail.tabCorrespondence",
  timeline: "detail.tabTimeline",
  photos: "detail.tabPhotos",
};

interface DetailPopoverTabBarProps {
  popoverId: string;
  activeTab: PopoverTab;
}

export function DetailPopoverTabBar({ popoverId, activeTab }: DetailPopoverTabBarProps) {
  const { t } = useDictionary("pipeline");
  const { setActiveTab } = useDetailPopoverStore();

  return (
    <div className="flex items-center border-b border-[rgba(255,255,255,0.06)] shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(popoverId, tab)}
          className={cn(
            "px-3 py-2 font-mohave text-[11px] uppercase tracking-[0.5px] transition-colors relative",
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
