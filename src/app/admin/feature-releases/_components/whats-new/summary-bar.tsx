"use client";

import { STATUS_OPTIONS, type WhatsNewCategory } from "./types";

interface SummaryBarProps {
  categories: WhatsNewCategory[];
  activeFilter: string | null;
  onFilterChange: (status: string | null) => void;
}

export function SummaryBar({ categories, activeFilter, onFilterChange }: SummaryBarProps) {
  const allItems = categories.flatMap((c) => c.whats_new_items);

  const counts = STATUS_OPTIONS.map((opt) => ({
    ...opt,
    count: allItems.filter((item) => item.status === opt.value).length,
  }));

  return (
    <div className="flex items-center gap-3 px-4 py-3 border border-white/[0.08] rounded bg-white/[0.02]">
      {counts.map((s) => (
        <button
          key={s.value}
          onClick={() => onFilterChange(activeFilter === s.value ? null : s.value)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
            activeFilter === s.value
              ? "bg-white/[0.08]"
              : "hover:bg-white/[0.04]"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: s.color }}
          />
          <span
            className={`font-mohave text-[11px] uppercase tracking-wider ${
              activeFilter === s.value ? "text-[#E5E5E5]" : "text-[#6B6B6B]"
            }`}
          >
            {s.count} {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}
