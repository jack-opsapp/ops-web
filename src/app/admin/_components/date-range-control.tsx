"use client";

import { useState, useCallback, useMemo } from "react";
import {
  startOfDay,
  subDays,
  subMonths,
  format,
} from "date-fns";
import type { Granularity, DatePreset, DateRangeParams } from "@/lib/admin/types";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "12m", label: "12M" },
  { key: "all", label: "All" },
];

const AUTO_GRANULARITY: Record<DatePreset, Granularity> = {
  today: "hourly",
  "7d": "daily",
  "30d": "daily",
  "90d": "weekly",
  "12m": "monthly",
  all: "monthly",
};

function presetToRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to };
    case "7d":
      return { from: subDays(now, 7), to };
    case "30d":
      return { from: subDays(now, 30), to };
    case "90d":
      return { from: subDays(now, 90), to };
    case "12m":
      return { from: subMonths(now, 12), to };
    case "all":
      return { from: new Date("2024-01-01"), to };
  }
}

interface DateRangeControlProps {
  defaultPreset?: DatePreset;
  presets?: DatePreset[];
  onChange: (params: DateRangeParams) => void;
  showGranularity?: boolean;
}

export function DateRangeControl({
  defaultPreset = "30d",
  presets,
  onChange,
  showGranularity = false,
}: DateRangeControlProps) {
  const [active, setActive] = useState<DatePreset>(defaultPreset);
  const [granOverride, setGranOverride] = useState<Granularity | null>(null);

  const visiblePresets = useMemo(
    () =>
      presets
        ? PRESETS.filter((p) => presets.includes(p.key))
        : PRESETS,
    [presets]
  );

  const handlePreset = useCallback(
    (preset: DatePreset) => {
      setActive(preset);
      setGranOverride(null);
      const { from, to } = presetToRange(preset);
      onChange({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: AUTO_GRANULARITY[preset],
      });
    },
    [onChange]
  );

  const handleGranularity = useCallback(
    (g: Granularity) => {
      setGranOverride(g);
      const { from, to } = presetToRange(active);
      onChange({
        from: from.toISOString(),
        to: to.toISOString(),
        granularity: g,
      });
    },
    [active, onChange]
  );

  const currentGranularity = granOverride ?? AUTO_GRANULARITY[active];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        {visiblePresets.map((p) => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`px-3 py-1 rounded-full font-mohave text-[12px] uppercase tracking-wider transition-colors ${
              active === p.key
                ? "bg-[#597794]/20 text-[#597794]"
                : "bg-white/[0.06] text-[#6B6B6B] hover:text-[#A0A0A0] hover:bg-white/[0.08]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {showGranularity && (
        <>
          <div className="w-px h-4 bg-white/[0.08] mx-1" />
          <div className="flex items-center gap-1">
            {(["hourly", "daily", "weekly", "monthly"] as Granularity[]).map(
              (g) => (
                <button
                  key={g}
                  onClick={() => handleGranularity(g)}
                  className={`px-2 py-1 rounded font-kosugi text-[11px] transition-colors ${
                    currentGranularity === g
                      ? "bg-white/[0.1] text-[#E5E5E5]"
                      : "text-[#6B6B6B] hover:text-[#A0A0A0]"
                  }`}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Hook for managing date range state with defaults */
export function useDateRange(defaultPreset: DatePreset = "30d") {
  const { from, to } = presetToRange(defaultPreset);
  const [params, setParams] = useState<DateRangeParams>({
    from: from.toISOString(),
    to: to.toISOString(),
    granularity: AUTO_GRANULARITY[defaultPreset],
  });

  return { params, setParams };
}
