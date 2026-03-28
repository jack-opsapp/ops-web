"use client";

import { useState } from "react";

interface FunnelStep {
  step: string;
  count: number;
}

interface FunnelChartProps {
  steps: FunnelStep[];
  onStepClick?: (step: FunnelStep, index: number) => void;
}

export function FunnelChart({ steps, onStepClick }: FunnelChartProps) {
  const max = steps[0]?.count ?? 1;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const pct = max > 0 ? Math.round((s.count / max) * 100) : 0;
        const dropOff =
          i > 0 && steps[i - 1].count > 0
            ? Math.round((1 - s.count / steps[i - 1].count) * 100)
            : null;
        const isHovered = hoveredIndex === i;

        return (
          <div
            key={s.step}
            className={`rounded-md px-2 py-1 -mx-2 transition-colors ${
              onStepClick ? "cursor-pointer" : ""
            } ${isHovered ? "bg-white/[0.04]" : ""}`}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={onStepClick ? () => onStepClick(s, i) : undefined}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mohave text-[13px] uppercase text-[#A0A0A0]">
                {s.step}
              </span>
              <div className="flex items-center gap-3">
                {dropOff !== null && dropOff > 0 && (
                  <span className="font-kosugi text-[12px] text-[#C4A868]">
                    [{dropOff}% drop]
                  </span>
                )}
                <span className="font-mohave text-[14px] text-[#E5E5E5]">
                  {s.count.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isHovered ? "bg-[#6B8DAD]" : "bg-[#597794]"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
