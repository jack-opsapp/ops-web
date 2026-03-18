"use client";

import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  getWeightedValue,
  formatCurrency,
  isActiveStage,
} from "@/lib/types/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineMetricsBarProps {
  opportunities: Opportunity[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Sub-component: a single metric cell (value + label stacked)
// ---------------------------------------------------------------------------

interface MetricCellProps {
  value: string;
  label: string;
  isLoading: boolean;
}

function MetricCell({ value, label, isLoading }: MetricCellProps) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span
        className={
          isLoading
            ? "font-mohave text-body-lg text-text-disabled"
            : "font-mohave text-body-lg text-text-primary"
        }
      >
        {isLoading ? "--" : value}
      </span>
      <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider between metrics
// ---------------------------------------------------------------------------

function MetricDivider() {
  return (
    <div className="h-[28px] w-px bg-[rgba(255,255,255,0.06)] self-center" />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PipelineMetricsBar({
  opportunities,
  isLoading,
}: PipelineMetricsBarProps) {
  const { t } = useDictionary("pipeline");

  const metrics = useMemo(() => {
    const activeDeals = opportunities.filter((opp) =>
      isActiveStage(opp.stage)
    );
    const wonDeals = opportunities.filter(
      (opp) => opp.stage === OpportunityStage.Won
    );
    const lostCount = opportunities.filter(
      (opp) => opp.stage === OpportunityStage.Lost
    ).length;

    const pipelineValue = activeDeals.reduce(
      (sum, opp) => sum + getWeightedValue(opp),
      0
    );

    const activeCount = activeDeals.length;
    const wonCount = wonDeals.length;

    const wonValue = wonDeals.reduce(
      (sum, opp) => sum + (opp.actualValue ?? opp.estimatedValue ?? 0),
      0
    );

    const conversionDenominator = wonCount + lostCount;
    const conversionRate =
      conversionDenominator > 0
        ? Math.round((wonCount / conversionDenominator) * 100)
        : 0;

    return {
      pipelineValue,
      activeCount,
      wonCount,
      wonValue,
      conversionRate,
    };
  }, [opportunities]);

  return (
    <div className="bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)] border border-[rgba(255,255,255,0.06)] rounded-[4px]">
      <div className="flex items-center gap-[16px] px-3 py-[8px]">
        {/* Pipeline value */}
        <MetricCell
          value={formatCurrency(metrics.pipelineValue)}
          label={t("metrics.pipelineValue")}
          isLoading={isLoading}
        />

        <MetricDivider />

        {/* Active count */}
        <MetricCell
          value={String(metrics.activeCount)}
          label={t("metrics.active")}
          isLoading={isLoading}
        />

        <MetricDivider />

        {/* Won value */}
        <MetricCell
          value={formatCurrency(metrics.wonValue)}
          label={t("metrics.won")}
          isLoading={isLoading}
        />

        {/* Conversion rate — hidden below xl (1280px) */}
        <div className="hidden xl:flex items-center gap-[16px]">
          <MetricDivider />
          <MetricCell
            value={`${metrics.conversionRate}%`}
            label={t("metrics.conversion")}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
