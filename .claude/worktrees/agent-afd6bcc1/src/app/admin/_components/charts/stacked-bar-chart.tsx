"use client";

import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { ChartSkeleton } from "./chart-skeleton";

interface StackedBarChartProps {
  data: { label: string; added: number; churned: number }[];
  isLoading?: boolean;
  onBarClick?: (point: { label: string; added: number; churned: number }) => void;
}

export function StackedBarChart({ data, isLoading, onBarClick }: StackedBarChartProps) {
  if (isLoading) return <ChartSkeleton height={200} />;

  const chartData = data.map((d) => ({ name: d.label, Added: d.added, Churned: -d.churned, _added: d.added, _churned: d.churned }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ReBarChart
        data={chartData}
        margin={{ top: 4, right: 0, left: -20, bottom: 0 }}
        onClick={
          onBarClick
            ? (state) => {
                if (state?.activePayload?.[0]) {
                  const p = state.activePayload[0].payload;
                  onBarClick({ label: p.name, added: p._added, churned: p._churned });
                }
              }
            : undefined
        }
      >
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: "#6B6B6B", fontFamily: "Kosugi", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#6B6B6B", fontFamily: "Kosugi", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1D1D1D",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            fontFamily: "Mohave",
            color: "#E5E5E5",
          }}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ fontFamily: "Mohave", fontSize: 12, color: "#A0A0A0" }}>
              {String(value).toUpperCase()}
            </span>
          )}
        />
        <Bar
          dataKey="Added"
          fill="#9DB582"
          radius={[2, 2, 0, 0]}
          stackId="stack"
          cursor={onBarClick ? "pointer" : undefined}
        />
        <Bar
          dataKey="Churned"
          fill="#93321A"
          radius={[0, 0, 2, 2]}
          stackId="stack"
          cursor={onBarClick ? "pointer" : undefined}
        />
      </ReBarChart>
    </ResponsiveContainer>
  );
}
