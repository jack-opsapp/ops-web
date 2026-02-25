"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkline } from "./sparkline";
import { DateRangeControl, useDateRange } from "./date-range-control";
import type { ChartDataPoint, DateRangeParams } from "@/lib/admin/types";

interface SparklineSet {
  companies: ChartDataPoint[];
  activeUsers: ChartDataPoint[];
  tasks: ChartDataPoint[];
  revenue: ChartDataPoint[];
}

interface OverviewSparklinesProps {
  initial: SparklineSet;
}

async function fetchSparklines(params: DateRangeParams): Promise<SparklineSet> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    granularity: params.granularity,
  });
  const res = await fetch(`/api/admin/overview/sparklines?${qs}`);
  if (!res.ok) throw new Error("Failed to fetch sparklines");
  return res.json();
}

const SPARKLINE_CARDS = [
  { key: "companies" as const, label: "New Companies", color: "#597794", href: "/admin/companies" },
  { key: "activeUsers" as const, label: "Active Users", color: "#9DB582", href: "/admin/engagement" },
  { key: "tasks" as const, label: "Tasks Created", color: "#8195B5", href: "/admin/engagement" },
  { key: "revenue" as const, label: "Revenue", color: "#C4A868", href: "/admin/revenue" },
];

export function OverviewSparklines({ initial }: OverviewSparklinesProps) {
  const router = useRouter();
  const { params, setParams } = useDateRange("90d");

  const { data } = useQuery({
    queryKey: ["overview-sparklines", params],
    queryFn: () => fetchSparklines(params),
    initialData: initial,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="font-mohave text-[13px] uppercase tracking-widest text-[#6B6B6B]">
          Trends
        </p>
        <DateRangeControl
          defaultPreset="90d"
          presets={["7d", "30d", "90d", "12m"]}
          onChange={setParams}
        />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {SPARKLINE_CARDS.map((card) => (
          <div
            key={card.key}
            className="border border-white/[0.08] rounded-lg p-4 bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04] transition-colors cursor-pointer"
            onClick={() => router.push(card.href)}
          >
            <p className="font-mohave text-[12px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              {card.label}
            </p>
            <Sparkline data={data[card.key]} color={card.color} />
          </div>
        ))}
      </div>
    </div>
  );
}
