"use client";

interface HorizontalBarItem {
  label: string;
  value: number;
  maxValue?: number;
}

interface HorizontalBarChartProps {
  data: HorizontalBarItem[];
  color?: string;
  suffix?: string;
}

export function HorizontalBarChart({ data, color = "#597794", suffix = "%" }: HorizontalBarChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.maxValue ?? d.value), 1);

  return (
    <div className="space-y-3">
      {data.map((item) => {
        const pct = max > 0 ? Math.round((item.value / max) * 100) : 0;
        return (
          <div key={item.label}>
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
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
