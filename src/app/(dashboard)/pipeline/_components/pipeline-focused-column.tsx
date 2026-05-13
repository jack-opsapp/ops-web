"use client";

import { memo, useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import { calculateBatchStaleness } from "./spatial-staleness";
import { PipelineFocusedCard } from "./pipeline-focused-card";

type FocusedColumnActionHandlers = {
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
};

export interface PipelineFocusedColumnProps extends FocusedColumnActionHandlers {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clientNameMap: Map<string, string>;
  canManage: boolean;
  filtersActive: boolean;
  focusedTabId: string;
  focusedPanelId: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onAddLead: () => void;
  onClearFilters: () => void;
}

export const PipelineFocusedColumn = memo(function PipelineFocusedColumn({
  stage,
  opportunities,
  clientNameMap,
  canManage,
  filtersActive,
  focusedTabId,
  focusedPanelId,
  isLoading = false,
  isError = false,
  onRetry,
  onAddLead,
  onClearFilters,
  onLogCall,
  onLogText,
  onAddNote,
  onArchive,
  onDiscard,
  onMarkWon,
  onMarkLost,
  onAssign,
  onScheduleFollowUp,
}: PipelineFocusedColumnProps) {
  const { t } = useDictionary("pipeline");
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];
  const stalenessMap = useMemo(
    () => calculateBatchStaleness(opportunities),
    [opportunities]
  );
  const emptyTitle = filtersActive
    ? t("focused.filteredEmpty.title", "// NO MATCHES FOR FILTERS")
    : t("focused.empty.title", "// NO LEADS");
  const emptyAction = filtersActive
    ? t("focused.filteredEmpty.action", "[CLEAR FILTERS]")
    : t("focused.empty.action", "[+ ADD LEAD]");
  const emptyActionHandler = filtersActive ? onClearFilters : onAddLead;

  return (
    <section
      id={focusedPanelId}
      role="tabpanel"
      aria-labelledby={focusedTabId}
      aria-busy={isLoading ? true : undefined}
      className="scrollbar-hide h-full min-h-0 overflow-y-auto pt-[188px]"
    >
      {isError ? (
        <div
          role="alert"
          data-testid="pipeline-focused-error"
          className="flex min-h-full flex-col items-start gap-3 pb-[44px] pt-[24px]"
        >
          <p className="font-mono text-caption-sm uppercase text-text">
            {t("focused.error.title", "// PIPELINE UNREACHABLE")}
          </p>
          <button
            type="button"
            className="rounded-chip border border-line px-3 py-2 font-cakemono text-caption-sm font-light uppercase text-text-2 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={() => {
              onRetry?.();
            }}
          >
            {t("focused.error.action", "[RETRY]")}
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex min-h-full flex-col gap-2 pb-[44px]">
          {[0, 1, 2].map((index) => (
            <FocusedLoadingCard key={index} stageColor={stageColor} />
          ))}
        </div>
      ) : opportunities.length > 0 ? (
        <div className="flex min-h-full flex-col gap-2 pb-[44px]">
          {opportunities.map((opportunity) => {
            const clientName =
              clientNameMap.get(opportunity.clientId ?? "") ??
              opportunity.contactName ??
              t("card.unknown", "Unknown");
            const cardStageColor =
              OPPORTUNITY_STAGE_COLORS[opportunity.stage] ?? stageColor;

            return (
              <PipelineFocusedCard
                key={opportunity.id}
                opportunity={opportunity}
                clientName={clientName}
                stageColor={cardStageColor}
                stalenessOpacity={stalenessMap.get(opportunity.id) ?? 1}
                canManage={canManage}
                onLogCall={() => onLogCall(opportunity.id)}
                onLogText={() => onLogText(opportunity.id)}
                onAddNote={(note) => onAddNote(opportunity.id, note)}
                onArchive={() => onArchive(opportunity.id)}
                onDiscard={() => onDiscard(opportunity.id)}
                onMarkWon={() => onMarkWon(opportunity)}
                onMarkLost={() => onMarkLost(opportunity)}
                onAssign={() => onAssign(opportunity.id)}
                onScheduleFollowUp={() => onScheduleFollowUp(opportunity.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-full flex-col items-start gap-3 pb-[44px] pt-[24px]">
          <p className="font-mono text-caption-sm uppercase text-text">
            {emptyTitle}
          </p>
          <button
            type="button"
            className="rounded-chip border border-line px-3 py-2 font-cakemono text-caption-sm font-light uppercase text-text-2 transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={emptyActionHandler}
          >
            {emptyAction}
          </button>
        </div>
      )}
    </section>
  );
});

function FocusedLoadingCard({ stageColor }: { stageColor: string }) {
  return (
    <div
      data-testid="pipeline-focused-loading-card"
      className="glass-surface relative isolate min-h-[116px] overflow-hidden rounded-panel border border-border p-2"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-0 top-2 w-[2px]"
        style={{ backgroundColor: stageColor }}
      />
      <div className="flex h-full animate-pulse flex-col gap-2 pl-2">
        <div className="h-[18px] w-2/3 rounded-bar bg-fill-neutral-dim" />
        <div className="h-[12px] w-1/2 rounded-bar bg-fill-neutral-dim" />
        <div className="mt-auto grid grid-cols-3 gap-2">
          <div className="h-[22px] rounded-bar bg-fill-neutral-dim" />
          <div className="h-[22px] rounded-bar bg-fill-neutral-dim" />
          <div className="h-[22px] rounded-bar bg-fill-neutral-dim" />
        </div>
      </div>
    </div>
  );
}
