"use client";

/**
 * TabStrip — 3-tab right-rail switcher per spec § 6.1
 * (WORK / ACCOUNTING / FILES). Cake Mono Light uppercase 11 with
 * 0.14em tracking, 2px text underline on active. Counts hidden when 0.
 */

import { cn } from "@/lib/utils/cn";

export type ContextTabKey = "work" | "accounting" | "files";

export interface ContextTab {
  key: ContextTabKey;
  label: string;
  count: number;
  disabled?: boolean;
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
        "flex h-[38px] shrink-0 items-stretch border-b border-line",
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
            disabled={tab.disabled}
            aria-disabled={tab.disabled ? "true" : undefined}
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] transition-colors",
              tab.disabled
                ? "cursor-default text-text-mute opacity-45"
                : isActive
                  ? "text-text"
                  : "text-text-3 hover:text-text-2",
            )}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  isActive ? "text-text-2" : "text-text-mute",
                )}
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
