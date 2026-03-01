"use client";

import { useMemo } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import {
  OpportunityStage,
  getStageDisplayName,
  getActiveStages,
  OPPORTUNITY_STAGE_SORT_ORDER,
} from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { useOpportunities } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineValueWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Opacity per active stage (lighter for early, darker for later)
// ---------------------------------------------------------------------------

const STAGE_OPACITY: Record<string, number> = {
  [OpportunityStage.NewLead]: 0.35,
  [OpportunityStage.Qualifying]: 0.45,
  [OpportunityStage.Quoting]: 0.55,
  [OpportunityStage.Quoted]: 0.65,
  [OpportunityStage.FollowUp]: 0.75,
  [OpportunityStage.Negotiation]: 0.9,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineValueWidget({ size }: PipelineValueWidgetProps) {
  const { t } = useDictionary("dashboard");
  const { data: opportunities, isLoading } = useOpportunities();

  const activeOpps = useMemo(() => {
    if (!opportunities) return [];
    return opportunities.filter(
      (o) =>
        !o.deletedAt &&
        o.stage !== OpportunityStage.Won &&
        o.stage !== OpportunityStage.Lost
    );
  }, [opportunities]);

  const stageValues = useMemo(() => {
    const stages = getActiveStages();
    return stages
      .map((stage) => {
        const opps = activeOpps.filter((o) => o.stage === stage);
        const totalValue = opps.reduce(
          (sum, o) => sum + (o.estimatedValue ?? 0),
          0
        );
        return {
          stage,
          label: getStageDisplayName(stage),
          value: totalValue,
          sortOrder: OPPORTUNITY_STAGE_SORT_ORDER[stage],
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [activeOpps]);

  const maxValue = useMemo(
    () => Math.max(...stageValues.map((s) => s.value), 1),
    [stageValues]
  );

  const weightedTotal = useMemo(
    () =>
      activeOpps.reduce(
        (sum, o) =>
          sum +
          ((o.estimatedValue ?? 0) * (o.winProbability ?? 0)) / 100,
        0
      ),
    [activeOpps]
  );

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <BarChart3 className="w-[14px] h-[14px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">{t("pipelineValue.title")}</CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${activeOpps.length} ${t("pipelineValue.active")}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              {t("pipelineValue.loading")}
            </span>
          </div>
        ) : (
          <>
            {/* Bar chart */}
            <div className="space-y-[3px]">
              {stageValues.map((s) => {
                const barWidth =
                  maxValue > 0
                    ? Math.max((s.value / maxValue) * 100, 2)
                    : 2;
                const opacity = STAGE_OPACITY[s.stage] ?? 0.5;

                return (
                  <div key={s.stage}>
                    <div className="flex items-center justify-between mb-[1px]">
                      <span className="font-mohave text-body-sm text-text-secondary">
                        {s.label}
                      </span>
                      <span className="font-mono text-[11px] text-text-tertiary">
                        ${s.value.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-ops-accent transition-all duration-500"
                        style={{
                          width: `${barWidth}%`,
                          opacity,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Weighted total */}
            <div className="mt-3 pt-2 border-t border-border flex items-center justify-between">
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary">
                {t("pipelineValue.weightedTotal")}
              </span>
              <span className="font-mono text-[11px] text-text-primary font-medium">
                ${Math.round(weightedTotal).toLocaleString()}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
