"use client";

import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ChartSkeleton } from "./chart-skeleton";

interface BarChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  isLoading?: boolean;
  onBarClick?: (point: { label: string; value: number }) => void;
}

export function AdminBarChart({
  data,
  color = "#597794",
  height = 200,
  isLoading,
  onBarClick,
}: BarChartProps) {
  if (isLoading) return <ChartSkeleton height={height} />;

  const chartData = data.map((d) => ({ name: d.label, value: d.value }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
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
        <Bar
          dataKey="value"
          fill={color}
          radius={[2, 2, 0, 0]}
          cursor={onBarClick ? "pointer" : undefined}
          onClick={
            onBarClick
              ? (data) => onBarClick({ label: data.name, value: data.value })
              : undefined
          }
        />
      </ReBarChart>
    </ResponsiveContainer>
  );
}
