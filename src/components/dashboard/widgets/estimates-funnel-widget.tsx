"use client";

import { useMemo } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { EstimateStatus } from "@/lib/types/pipeline";
import type { Estimate } from "@/lib/types/pipeline";
import { useEstimates } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EstimatesFunnelWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Funnel stages in lifecycle order */
const FUNNEL_STAGES = [
  { key: EstimateStatus.Draft, label: "Draft" },
  { key: EstimateStatus.Sent, label: "Sent" },
  { key: EstimateStatus.Viewed, label: "Viewed" },
  { key: EstimateStatus.Approved, label: "Approved" },
] as const;

/** Opacity gradient: lightest at Draft, darkest at Approved */
const STAGE_OPACITY = [0.4, 0.6, 0.8, 1.0];

function formatCurrency(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  }
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function daysBetween(a: Date | string | null, b: Date | string | null): number | null {
  if (!a || !b) return null;
  const dateA = typeof a === "string" ? new Date(a) : a;
  const dateB = typeof b === "string" ? new Date(b) : b;
  const diffMs = dateB.getTime() - dateA.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimatesFunnelWidget({ size }: EstimatesFunnelWidgetProps) {
  const { data: estimates, isLoading } = useEstimates();

  // Count estimates at each stage (including those that passed through)
  const funnelData = useMemo(() => {
    if (!estimates) {
      return FUNNEL_STAGES.map((s) => ({
        ...s,
        count: 0,
        totalValue: 0,
      }));
    }

    const activeEstimates = estimates.filter((e) => !e.deletedAt);

    // For funnel: count estimates that reached at least this stage
    // Draft: all non-deleted estimates
    // Sent: those with sentAt or status >= sent
    // Viewed: those with viewedAt or status >= viewed
    // Approved: those with approvedAt or status = approved/converted
    const reachedStage = (est: Estimate, stage: EstimateStatus): boolean => {
      switch (stage) {
        case EstimateStatus.Draft:
          return true;
        case EstimateStatus.Sent:
          return !!est.sentAt || [
            EstimateStatus.Sent,
            EstimateStatus.Viewed,
            EstimateStatus.Approved,
            EstimateStatus.Converted,
            EstimateStatus.ChangesRequested,
            EstimateStatus.Declined,
          ].includes(est.status);
        case EstimateStatus.Viewed:
          return !!est.viewedAt || [
            EstimateStatus.Viewed,
            EstimateStatus.Approved,
            EstimateStatus.Converted,
            EstimateStatus.ChangesRequested,
            EstimateStatus.Declined,
          ].includes(est.status);
        case EstimateStatus.Approved:
          return !!est.approvedAt || [
            EstimateStatus.Approved,
            EstimateStatus.Converted,
          ].includes(est.status);
        default:
          return false;
      }
    };

    return FUNNEL_STAGES.map((stage) => {
      const matching = activeEstimates.filter((e) => reachedStage(e, stage.key));
      return {
        ...stage,
        count: matching.length,
        totalValue: matching.reduce((sum, e) => sum + e.total, 0),
      };
    });
  }, [estimates]);

  // Conversion rates between adjacent stages
  const conversions = useMemo(() => {
    const rates: { from: string; to: string; rate: number }[] = [];
    for (let i = 0; i < funnelData.length - 1; i++) {
      const fromCount = funnelData[i].count;
      const toCount = funnelData[i + 1].count;
      rates.push({
        from: funnelData[i].label,
        to: funnelData[i + 1].label,
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
      });
    }
    return rates;
  }, [funnelData]);

  // Average time at each stage (LG only)
  const avgTimes = useMemo(() => {
    if (!estimates || size !== "lg") return null;

    const activeEstimates = estimates.filter((e) => !e.deletedAt);

    // Draft → Sent: avg days from issueDate to sentAt
    const draftToSent = activeEstimates
      .map((e) => daysBetween(e.issueDate, e.sentAt))
      .filter((d): d is number => d !== null);
    const avgDraftToSent =
      draftToSent.length > 0
        ? Math.round(draftToSent.reduce((a, b) => a + b, 0) / draftToSent.length)
        : null;

    // Sent → Viewed: avg days from sentAt to viewedAt
    const sentToViewed = activeEstimates
      .map((e) => daysBetween(e.sentAt, e.viewedAt))
      .filter((d): d is number => d !== null);
    const avgSentToViewed =
      sentToViewed.length > 0
        ? Math.round(sentToViewed.reduce((a, b) => a + b, 0) / sentToViewed.length)
        : null;

    // Viewed → Approved: avg days from viewedAt to approvedAt
    const viewedToApproved = activeEstimates
      .map((e) => daysBetween(e.viewedAt, e.approvedAt))
      .filter((d): d is number => d !== null);
    const avgViewedToApproved =
      viewedToApproved.length > 0
        ? Math.round(
            viewedToApproved.reduce((a, b) => a + b, 0) / viewedToApproved.length
          )
        : null;

    return [avgDraftToSent, avgSentToViewed, avgViewedToApproved];
  }, [estimates, size]);

  const maxCount = funnelData.length > 0 ? Math.max(...funnelData.map((s) => s.count), 1) : 1;

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">
            Estimate Conversion
          </CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading ? "..." : `${funnelData[0]?.count ?? 0} total`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading funnel...
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            {funnelData.map((stage, i) => (
              <div key={stage.key}>
                {/* Stage bar */}
                <div className="flex items-center gap-1.5">
                  {/* Label */}
                  <span className="font-mohave text-body-sm text-text-secondary w-[60px] shrink-0 text-right">
                    {stage.label}
                  </span>

                  {/* Bar */}
                  <div className="flex-1 min-w-0">
                    <div className="h-[20px] rounded relative overflow-hidden bg-[rgba(255,255,255,0.04)]">
                      <div
                        className="h-full rounded transition-all duration-500 flex items-center justify-end pr-1.5"
                        style={{
                          width: `${Math.max(8, (stage.count / maxCount) * 100)}%`,
                          backgroundColor: "var(--ops-accent)",
                          opacity: STAGE_OPACITY[i],
                        }}
                      >
                        <span className="font-mono text-[11px] text-white/90">
                          {stage.count}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Value (LG only) */}
                  {size === "lg" && (
                    <span className="font-mono text-[11px] text-text-tertiary w-[50px] shrink-0 text-right">
                      {formatCurrency(stage.totalValue)}
                    </span>
                  )}
                </div>

                {/* Conversion rate between stages (lg only to save space) */}
                {size === "lg" && i < conversions.length && (
                  <div className="flex items-center gap-1.5 py-[2px]">
                    <div className="w-[60px] shrink-0" />
                    <div className="flex items-center gap-0.5 pl-2">
                      <ChevronRight className="w-[10px] h-[10px] text-text-disabled" />
                      <span className="font-mono text-[10px] text-text-disabled">
                        {conversions[i].rate}%
                      </span>
                      {avgTimes && avgTimes[i] !== null && (
                        <span className="font-mono text-[10px] text-text-disabled ml-1">
                          avg {avgTimes[i]}d
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
