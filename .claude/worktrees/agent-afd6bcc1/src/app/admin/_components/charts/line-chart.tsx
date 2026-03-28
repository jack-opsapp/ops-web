"use client";

import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ChartSkeleton } from "./chart-skeleton";

interface LineChartProps {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  isLoading?: boolean;
  onDataPointClick?: (point: { label: string; value: number }) => void;
}

export function AdminLineChart({
  data,
  color = "#597794",
  height = 200,
  isLoading,
  onDataPointClick,
}: LineChartProps) {
  if (isLoading) return <ChartSkeleton height={height} />;

  const chartData = data.map((d) => ({ name: d.label, value: d.value }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart
        data={chartData}
        margin={{ top: 4, right: 0, left: -20, bottom: 0 }}
        onClick={
          onDataPointClick
            ? (state) => {
                if (state?.activePayload?.[0]) {
                  const p = state.activePayload[0].payload;
                  onDataPointClick({ label: p.name, value: p.value });
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
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 6, fill: color, cursor: onDataPointClick ? "pointer" : "default" }}
        />
      </ReLineChart>
    </ResponsiveContainer>
  );
}
