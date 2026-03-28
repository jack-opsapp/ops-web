"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, Sector } from "recharts";

interface DonutChartProps {
  data: { name: string; value: number; color: string }[];
  onSegmentClick?: (segment: { name: string; value: number }) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius - 2}
      outerRadius={outerRadius + 4}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  );
}

export function AdminDonutChart({ data, onSegmentClick }: DonutChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={85}
          paddingAngle={2}
          dataKey="value"
          activeIndex={activeIndex}
          activeShape={renderActiveShape}
          onMouseEnter={(_, index) => setActiveIndex(index)}
          onMouseLeave={() => setActiveIndex(undefined)}
          onClick={
            onSegmentClick
              ? (entry) => onSegmentClick({ name: entry.name, value: entry.value })
              : undefined
          }
          cursor={onSegmentClick ? "pointer" : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#1D1D1D",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            fontFamily: "Mohave",
            color: "#E5E5E5",
          }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ fontFamily: "Mohave", fontSize: 12, color: "#A0A0A0" }}>
              {String(value).toUpperCase()}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
