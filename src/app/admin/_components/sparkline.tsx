"use client";

import { AreaChart, Area, ResponsiveContainer } from "recharts";

interface SparklineProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
}

export function Sparkline({ data, color = "#597794", height = 48 }: SparklineProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));

  if (chartData.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center">
      <span className="font-kosugi text-[11px] text-[#6B6B6B]">[no data]</span>
    </div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sparkGrad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#sparkGrad-${color.replace("#", "")})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
