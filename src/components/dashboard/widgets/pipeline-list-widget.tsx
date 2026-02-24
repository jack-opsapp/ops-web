"use client";

import { useMemo } from "react";
import { Loader2, List } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import {
  OpportunityStage,
  getStageDisplayName,
  getActiveStages,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import type { Opportunity } from "@/lib/types/pipeline";
import { useOpportunities } from "@/lib/hooks";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PipelineListWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StageFilter =
  | "all-active"
  | "new_lead"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "negotiation";

const FILTER_LABEL: Record<StageFilter, string> = {
  "all-active": "Active Pipeline",
  new_lead: "New Leads",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
};

/** Map config filter values to actual OpportunityStage enum values */
function mapFilterToStage(filter: StageFilter): OpportunityStage | null {
  switch (filter) {
    case "new_lead":
      return OpportunityStage.NewLead;
    case "contacted":
      return OpportunityStage.Qualifying;
    case "qualified":
      return OpportunityStage.Quoting;
    case "proposal_sent":
      return OpportunityStage.Quoted;
    case "negotiation":
      return OpportunityStage.Negotiation;
    default:
      return null;
  }
}

function filterOpportunities(
  opportunities: Opportunity[],
  filter: StageFilter
): Opportunity[] {
  const active = opportunities.filter((o) => !o.deletedAt);
  if (filter === "all-active") {
    return active.filter(
      (o) =>
        o.stage !== OpportunityStage.Won && o.stage !== OpportunityStage.Lost
    );
  }
  const stage = mapFilterToStage(filter);
  if (!stage) return active;
  return active.filter((o) => o.stage === stage);
}

function daysInStage(stageEnteredAt: Date | string): number {
  const entered =
    typeof stageEnteredAt === "string"
      ? new Date(stageEnteredAt)
      : stageEnteredAt;
  const now = new Date();
  return Math.floor((now.getTime() - entered.getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PipelineListWidget({ size, config }: PipelineListWidgetProps) {
  const filter = (config.stageFilter as StageFilter) ?? "all-active";
  const { data: opportunities, isLoading } = useOpportunities();

  const filtered = useMemo(() => {
    if (!opportunities) return [];
    return filterOpportunities(opportunities, filter);
  }, [opportunities, filter]);

  const totalValue = useMemo(
    () =>
      filtered.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0),
    [filtered]
  );

  // ── SM: Count + total value ─────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">
            {FILTER_LABEL[filter]}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-1">
              <Loader2 className="w-[14px] h-[14px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled">
                Loading...
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-data-lg text-text-primary">
                {filtered.length}
              </span>
              <span className="font-mono text-[11px] text-text-tertiary">
                ${totalValue.toLocaleString()}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── LG: Grouped by stage, up to 8 visible ──────────────────────────────
  if (size === "lg") {
    const activeStages = getActiveStages();
    const grouped = activeStages
      .map((stage) => ({
        stage,
        label: getStageDisplayName(stage),
        color: OPPORTUNITY_STAGE_COLORS[stage],
        items: filtered.filter((o) => o.stage === stage),
      }))
      .filter((g) => g.items.length > 0);

    let remainingSlots = 8;

    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <List className="w-[14px] h-[14px] text-text-tertiary" />
              <CardTitle className="text-card-subtitle">
                {FILTER_LABEL[filter]}
              </CardTitle>
            </div>
            <span className="font-mono text-[11px] text-text-tertiary">
              {isLoading
                ? "..."
                : `${filtered.length} \u00B7 $${totalValue.toLocaleString()}`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
              <span className="font-mono text-[11px] text-text-disabled ml-1">
                Loading pipeline...
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="font-mohave text-body-sm text-text-disabled py-2">
              No opportunities
            </p>
          ) : (
            <div className="space-y-2">
              {grouped.map((group) => {
                if (remainingSlots <= 0) return null;
                const visibleItems = group.items.slice(0, remainingSlots);
                remainingSlots -= visibleItems.length;

                return (
                  <div key={group.stage}>
                    {/* Stage header */}
                    <div className="flex items-center gap-1 mb-0.5 px-1">
                      <span
                        className="w-[8px] h-[8px] rounded-sm shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="font-kosugi text-[10px] uppercase tracking-widest text-text-secondary">
                        {group.label}
                      </span>
                      <span className="font-mono text-[11px] text-text-disabled ml-auto">
                        {group.items.length}
                      </span>
                    </div>
                    {/* Items */}
                    <div className="space-y-[6px]">
                      {visibleItems.map((opp) => (
                        <OpportunityRow key={opp.id} opportunity={opp} />
                      ))}
                      {group.items.length > visibleItems.length && (
                        <span className="font-mono text-[11px] text-text-disabled block px-1">
                          +{group.items.length - visibleItems.length} more
                        </span>
                      )}
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

  // ── MD: List of up to 5 opportunities ───────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <List className="w-[14px] h-[14px] text-text-tertiary" />
            <CardTitle className="text-card-subtitle">
              {FILTER_LABEL[filter]}
            </CardTitle>
          </div>
          <span className="font-mono text-[11px] text-text-tertiary">
            {isLoading
              ? "..."
              : `${filtered.length} \u00B7 $${totalValue.toLocaleString()}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[16px] h-[16px] text-text-disabled animate-spin" />
            <span className="font-mono text-[11px] text-text-disabled ml-1">
              Loading pipeline...
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="font-mohave text-body-sm text-text-disabled py-2">
            No opportunities
          </p>
        ) : (
          <div className="space-y-[6px]">
            {filtered.slice(0, 5).map((opp) => (
              <OpportunityRow key={opp.id} opportunity={opp} />
            ))}
            {filtered.length > 5 && (
              <span className="font-mono text-[11px] text-text-disabled block px-1">
                +{filtered.length - 5} more
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Opportunity row
// ---------------------------------------------------------------------------

function OpportunityRow({ opportunity }: { opportunity: Opportunity }) {
  const days = daysInStage(opportunity.stageEnteredAt);

  return (
    <div className="flex items-center gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors">
      <div className="flex-1 min-w-0">
        <p className="font-mohave text-body-sm text-text-primary truncate">
          {opportunity.title}
        </p>
        <span className="font-mono text-[11px] text-text-tertiary">
          {opportunity.contactName ?? "Unknown"}
        </span>
      </div>
      <span className="font-mono text-[11px] text-text-secondary shrink-0">
        {opportunity.estimatedValue != null
          ? `$${opportunity.estimatedValue.toLocaleString()}`
          : "\u2014"}
      </span>
      <span className="font-mono text-[11px] text-text-disabled shrink-0">
        {days}d
      </span>
    </div>
  );
}
