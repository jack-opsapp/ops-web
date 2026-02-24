"use client";

import { useMemo } from "react";
import { Loader2, PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import type { Opportunity } from "@/lib/types/pipeline";
import { OpportunitySource } from "@/lib/types/pipeline";
import { useOpportunities } from "@/lib/hooks";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineSourcesWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cycle palette for bars */
const BAR_COLORS = [
  "bg-ops-accent",
  "bg-ops-amber",
  "bg-status-success",
  "bg-status-in-progress",
  "bg-status-archived",
];

/** Capitalize source labels: "social_media" -> "Social Media" */
function formatSourceLabel(source: string): string {
  return source
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineSourcesWidget({ size }: PipelineSourcesWidgetProps) {
  const { data: opportunities, isLoading } = useOpportunities();

  const sourceData = useMemo(() => {
    if (!opportunities) return [];

    const activeOpps = opportunities.filter((o) => !o.deletedAt);

    // Group by source
    const counts = new Map<string, number>();
    for (const opp of activeOpps) {
      const source = opp.source ?? "other";
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    // Sort by count descending
    const sorted = Array.from(counts.entries())
      .map(([source, count]) => ({
        source,
        label: formatSourceLabel(source),
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return sorted;
  }, [opportunities]);

  const maxCount = useMemo(
    () => Math.max(...sourceData.map((s) => s.count), 1),
    [sourceData]
  );

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <PieChart className="w-[14px] h-[14px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">Lead Sources</CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${sourceData.length} sources`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading sources...
            </span>
          </div>
        ) : sourceData.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No opportunity sources
          </p>
        ) : (
          <div className="space-y-[6px]">
            {sourceData.map((s, i) => {
              const barWidth = Math.max((s.count / maxCount) * 100, 4);
              const colorClass = BAR_COLORS[i % BAR_COLORS.length];

              return (
                <div key={s.source}>
                  <div className="flex items-center justify-between mb-[2px]">
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {s.label}
                    </span>
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {s.count}
                    </span>
                  </div>
                  <div className="h-[6px] rounded-full bg-border overflow-hidden">
                    <div
                      className={`h-full rounded-full ${colorClass} transition-all duration-500`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
