"use client";

import { useState } from "react";

interface HorizontalBarItem {
  label: string;
  value: number;
  maxValue?: number;
}

interface HorizontalBarChartProps {
  data: HorizontalBarItem[];
  color?: string;
  suffix?: string;
  onBarClick?: (item: HorizontalBarItem) => void;
}

export function HorizontalBarChart({
  data,
  color = "#597794",
  suffix = "%",
  onBarClick,
}: HorizontalBarChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.maxValue ?? d.value), 1);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const pct = max > 0 ? Math.round((item.value / max) * 100) : 0;
        const isHovered = hoveredLabel === item.label;
        return (
          <div
            key={item.label}
            className={`rounded-md px-2 py-1 -mx-2 transition-colors ${
              onBarClick ? "cursor-pointer" : ""
            } ${isHovered ? "bg-white/[0.04]" : ""}`}
            onMouseEnter={() => setHoveredLabel(item.label)}
            onMouseLeave={() => setHoveredLabel(null)}
            onClick={onBarClick ? () => onBarClick(item) : undefined}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mohave text-[13px] text-[#A0A0A0]">
                {item.label}
              </span>
              <span className="font-mohave text-[14px] text-[#E5E5E5]">
                {item.value}{suffix}
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: isHovered ? "#6B8DAD" : color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
