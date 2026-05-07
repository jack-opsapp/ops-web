"use client";

import { cn } from "@/lib/utils/cn";

export type ContextTabKey = "projects" | "pipeline" | "files";

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
              "relative flex flex-1 items-center justify-center gap-1.5 font-mohave text-[11.5px] uppercase tracking-[0.2em] transition-colors",
              isActive
                ? "text-text"
                : "text-text-3 hover:text-text-2",
            )}
          >
            <span>{tab.label}</span>
            <span
              className="font-mono text-[10px] tabular-nums text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {tab.count}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="absolute bottom-0 left-3 right-3 h-[2px] bg-ops-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
