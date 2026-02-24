"use client";

import { useMemo } from "react";
import { Loader2, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { OpportunityStage } from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { useOpportunities } from "@/lib/hooks";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineVelocityWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineVelocityWidget({ size }: PipelineVelocityWidgetProps) {
  const { data: opportunities, isLoading } = useOpportunities();

  const metrics = useMemo(() => {
    if (!opportunities) {
      return {
        avgDaysToClose: 0,
        winRate: 0,
        avgDealSize: 0,
        activePipeline: 0,
      };
    }

    const active = opportunities.filter(
      (o) =>
        !o.deletedAt &&
        o.stage !== OpportunityStage.Won &&
        o.stage !== OpportunityStage.Lost
    );

    const won = opportunities.filter(
      (o) => !o.deletedAt && o.stage === OpportunityStage.Won
    );

    const lost = opportunities.filter(
      (o) => !o.deletedAt && o.stage === OpportunityStage.Lost
    );

    // Avg Days to Close: average of (actualCloseDate - createdAt) for Won
    let avgDaysToClose = 0;
    if (won.length > 0) {
      const totalDays = won.reduce((sum, o) => {
        if (!o.actualCloseDate) return sum;
        const closed =
          typeof o.actualCloseDate === "string"
            ? new Date(o.actualCloseDate)
            : o.actualCloseDate;
        const created =
          typeof o.createdAt === "string"
            ? new Date(o.createdAt)
            : o.createdAt;
        const days = Math.floor(
          (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
        );
        return sum + days;
      }, 0);
      avgDaysToClose = Math.round(totalDays / won.length);
    }

    // Win Rate: Won / (Won + Lost) * 100
    const totalClosed = won.length + lost.length;
    const winRate =
      totalClosed > 0 ? Math.round((won.length / totalClosed) * 100) : 0;

    // Avg Deal Size: average estimatedValue of Won opportunities
    let avgDealSize = 0;
    if (won.length > 0) {
      const totalValue = won.reduce(
        (sum, o) => sum + (o.estimatedValue ?? 0),
        0
      );
      avgDealSize = Math.round(totalValue / won.length);
    }

    // Active Pipeline: count of active (non-Won, non-Lost)
    const activePipeline = active.length;

    return { avgDaysToClose, winRate, avgDealSize, activePipeline };
  }, [opportunities]);

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center gap-1">
          <Gauge className="w-[14px] h-[14px] text-text-tertiary" />
          <CardTitle className="text-card-subtitle">Pipeline Velocity</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading metrics...
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1">
            {/* Avg Days to Close */}
            <div className="flex flex-col items-center justify-center py-2">
              <span className="font-mono text-data-lg text-text-primary">
                {metrics.avgDaysToClose}
              </span>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary mt-0.5">
                Avg Days to Close
              </span>
            </div>

            {/* Win Rate */}
            <div className="flex flex-col items-center justify-center py-2">
              <span className="font-mono text-data-lg text-text-primary">
                {metrics.winRate}%
              </span>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary mt-0.5">
                Win Rate
              </span>
            </div>

            {/* Avg Deal Size */}
            <div className="flex flex-col items-center justify-center py-2">
              <span className="font-mono text-data-lg text-text-primary">
                ${metrics.avgDealSize.toLocaleString()}
              </span>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary mt-0.5">
                Avg Deal Size
              </span>
            </div>

            {/* Active Pipeline */}
            <div className="flex flex-col items-center justify-center py-2">
              <span className="font-mono text-data-lg text-text-primary">
                {metrics.activePipeline}
              </span>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary mt-0.5">
                Active Pipeline
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
