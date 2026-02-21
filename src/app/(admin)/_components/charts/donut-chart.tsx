"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface DonutChartProps {
  data: { name: string; value: number; color: string }[];
}

export function AdminDonutChart({ data }: DonutChartProps) {
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
