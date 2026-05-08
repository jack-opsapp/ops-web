"use client";

/**
 * TabStrip — 4-tab right-rail switcher per the production mockup
 * (Pipeline / Tasks / Files / Threads). Sentence-case labels, full-width
 * accent underline on active. Counts hidden when 0.
 */

import { cn } from "@/lib/utils/cn";

export type ContextTabKey = "pipeline" | "tasks" | "files" | "threads";

export interface ContextTab {
  key: ContextTabKey;
  label: string;
  count: number;
}

interface TabStripProps {
  tabs: ContextTab[];
  active: ContextTabKey;
  onSelect: (key: ContextTabKey) => void;
  className?: string;
}

export function TabStrip({ tabs, active, onSelect, className }: TabStripProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex h-[38px] shrink-0 items-stretch border-b border-line bg-inbox-panel",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 font-mohave text-[12px] tracking-[-0.003em] transition-colors",
              isActive ? "text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                className="font-mono text-[11px] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {tab.count}
              </span>
            )}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] bg-text"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
