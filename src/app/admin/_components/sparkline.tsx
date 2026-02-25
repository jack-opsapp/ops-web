"use client";

import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";

interface SparklineProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  onClick?: () => void;
}

export function Sparkline({ data, color = "#597794", height = 48, onClick }: SparklineProps) {
  const chartData = data.map((d) => ({ name: d.label, value: d.value }));

  if (chartData.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center">
      <span className="font-kosugi text-[11px] text-[#6B6B6B]">[no data]</span>
    </div>;
  }

  return (
    <div
      className={onClick ? "cursor-pointer" : undefined}
      onClick={onClick}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`sparkGrad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{
              backgroundColor: "#1D1D1D",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "6px",
              fontFamily: "Mohave",
              fontSize: 12,
              color: "#E5E5E5",
              padding: "4px 8px",
            }}
            labelStyle={{ display: "none" }}
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeWidth: 1 }}
          />
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
    </div>
  );
}
