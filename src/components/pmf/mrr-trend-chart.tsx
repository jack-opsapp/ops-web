"use client";
import { useEffect, useState } from "react";
import {
  LineChart, Line, ResponsiveContainer, CartesianGrid,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { PmfCard } from "@/components/pmf/ui/card";
import { SlashHeader } from "@/components/pmf/ui/slash-header";
import { fmtUsd } from "@/lib/pmf/formatters";

interface WeekPoint {
  week: string;
  mrr_cents: number;
}

async function fetchMrr(): Promise<WeekPoint[]> {
  const res = await fetch("/api/admin/pmf/mrr-trend");
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const json = (await res.json()) as { data?: WeekPoint[] };
  return json.data ?? [];
}

export function MrrTrendChart() {
  const [data, setData] = useState<WeekPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMrr()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <PmfCard className="p-4">
        <SlashHeader variant="section">BASE SAAS · MRR TREND</SlashHeader>
        <div className="h-[460px] mt-4 animate-pulse bg-[rgba(255,255,255,0.02)] rounded" />
      </PmfCard>
    );
  }

  if (error) {
    return (
      <PmfCard className="p-4">
        <SlashHeader variant="section">BASE SAAS · MRR TREND</SlashHeader>
        <div className="h-[460px] mt-4 flex items-center justify-center font-mono text-[11px] text-[color:var(--rose)]">
          {"// ERROR — FAILED TO LOAD"}<br />
          {error}
        </div>
      </PmfCard>
    );
  }

  return (
    <PmfCard className="p-4">
      <SlashHeader variant="section">BASE SAAS · MRR TREND</SlashHeader>
      <div className="h-[460px] mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
            <XAxis
              dataKey="week"
              stroke="#6A6A6A"
              tick={{ fontFamily: "JetBrains Mono", fontSize: 11 }}
            />
            <YAxis
              stroke="#6A6A6A"
              tick={{ fontFamily: "JetBrains Mono", fontSize: 11 }}
              tickFormatter={(v: number) => fmtUsd(v)}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(10,10,10,0.85)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 5,
              }}
              labelStyle={{ color: "#B5B5B5", fontFamily: "JetBrains Mono", fontSize: 11 }}
              formatter={(v: number) => fmtUsd(v)}
            />
            <ReferenceLine
              y={1_500_000}
              stroke="#6A6A6A"
              strokeDasharray="2 4"
              label={{ value: "$15K TARGET", fill: "#6A6A6A", fontSize: 10, fontFamily: "JetBrains Mono" }}
            />
            <Line
              type="monotone"
              dataKey="mrr_cents"
              stroke="#EDEDED"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </PmfCard>
  );
}
