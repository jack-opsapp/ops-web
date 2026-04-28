"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PerDomainBounce } from "@/lib/admin/email-campaign-types";

interface DomainBounceChartProps {
  data: PerDomainBounce[];
}

export function DomainBounceChart({ data }: DomainBounceChartProps) {
  const sorted = [...data].sort((a, b) => b.bounces - a.bounces).slice(0, 10);

  if (sorted.length === 0) {
    return (
      <div className="rounded-panel border border-glass-border px-6 py-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          // ZERO BOUNCES
        </div>
        <p className="mt-2 font-mohave text-[14px] text-text-2">
          No bounce events recorded for this campaign.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-panel border border-glass-border px-4 py-4"
      style={{ height: 320 }}
    >
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        // BOUNCES BY DOMAIN — TOP {sorted.length}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <XAxis
            type="number"
            stroke="var(--text-mute)"
            tick={{
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              fill: "var(--text-3)",
            }}
          />
          <YAxis
            dataKey="domain"
            type="category"
            stroke="var(--text-mute)"
            width={120}
            tick={{
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              fill: "var(--text-2)",
            }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-glass-dense)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 5,
              fontFamily: "JetBrains Mono",
              fontSize: 11,
            }}
          />
          <Bar dataKey="bounces" radius={[0, 2, 2, 0]}>
            {sorted.map((_, i) => (
              <Cell
                key={i}
                fill={i === 0 ? "var(--color-tan)" : "var(--color-ops-accent)"}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
