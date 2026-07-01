"use client";

import { memo, useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import {
  getDaysInStage,
  getStageDisplayName,
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { calculateBatchStaleness } from "./pipeline-staleness";
import { PipelineFocusedCard } from "./pipeline-focused-card";
import type { PipelineCardEditHandlers } from "./pipeline-card-content";

type FocusedColumnActionHandlers = {
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onConvert?: (opportunity: Opportunity) => void;
  onMoveStage: (id: string, stage: OpportunityStage) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
} & Partial<PipelineCardEditHandlers>;

export interface PipelineFocusedColumnProps extends FocusedColumnActionHandlers {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clients?: Client[];
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

const FOCUSED_LIST_END_PADDING = "pb-[360px]";

export const PipelineFocusedColumn = memo(function PipelineFocusedColumn({
  stage,
  opportunities,
  clients = [],
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
  onConvert,
  onMoveStage,
  onAssign,
  onScheduleFollowUp,
  onTitleSave,
  onLinkClient,
  onCreateAndLinkClient,
  onAddressSave,
}: PipelineFocusedColumnProps) {
  const { t } = useDictionary("pipeline");
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[stage] ??
    OPPORTUNITY_STAGE_COLORS[OpportunityStage.NewLead];
  const stalenessMap = useMemo(
    () => calculateBatchStaleness(opportunities),
    [opportunities]
  );
  const oldestDaysInStage = useMemo(() => {
    if (opportunities.length === 0) return null;
    return Math.max(
      ...opportunities.map((opportunity) => getDaysInStage(opportunity))
    );
  }, [opportunities]);
  const emptyTitle = filtersActive
    ? t("focused.filteredEmpty.title", "// NO MATCHES FOR FILTERS")
    : t("focused.empty.title", "// NO LEADS");
  const emptyAction = filtersActive
    ? t("focused.filteredEmpty.action", "[CLEAR FILTERS]")
    : t("focused.empty.action", "[+ ADD LEAD]");
  const emptyActionHandler = filtersActive ? onClearFilters : onAddLead;
  const cardLabel = t(
    opportunities.length === 1
      ? "focused.listSummary.cardSingular"
      : "focused.listSummary.cardPlural",
    opportunities.length === 1 ? "CARD" : "CARDS"
  );
  const oldestValue =
    oldestDaysInStage === null
      ? t("focused.listSummary.oldestEmpty", "-")
      : t("focused.listSummary.ageDays", "{count}D").replace(
          "{count}",
          String(oldestDaysInStage)
        );
  const listSummary = t(
    "focused.listSummary.text",
    "{count} {cardLabel} IN {stage} STAGE, OLDEST {oldest}"
  )
    .replace("{count}", String(opportunities.length))
    .replace("{cardLabel}", cardLabel)
    .replace("{stage}", getStageDisplayName(stage).toUpperCase())
    .replace("{oldest}", oldestValue);

  return (
    <section
      id={focusedPanelId}
      role="tabpanel"
      aria-labelledby={focusedTabId}
      aria-busy={isLoading ? true : undefined}
      className="scrollbar-hide h-full min-h-0 overflow-y-auto scroll-pb-[360px] pt-[68px]"
    >
      {isError ? (
        <div
          role="alert"
          data-testid="pipeline-focused-error"
          className={`flex min-h-full flex-col items-start gap-3 ${FOCUSED_LIST_END_PADDING} pt-[24px]`}
        >
          <p className="font-mono text-caption-sm uppercase tracking-[0.16em] text-text">
            {t("focused.error.title", "// PIPELINE UNREACHABLE")}
          </p>
          <button
            type="button"
            className="rounded-chip border border-line px-3 py-2 font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={() => {
              onRetry?.();
            }}
          >
            {t("focused.error.action", "[RETRY]")}
          </button>
        </div>
      ) : isLoading ? (
        <div
          className={`flex min-h-full flex-col gap-2 ${FOCUSED_LIST_END_PADDING}`}
        >
          {[0, 1, 2].map((index) => (
            <FocusedLoadingCard key={index} stageColor={stageColor} />
          ))}
        </div>
      ) : opportunities.length > 0 ? (
        <div
          className={`flex min-h-full flex-col gap-2 ${FOCUSED_LIST_END_PADDING}`}
        >
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
                clients={clients}
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
                onConvert={
                  opportunity.stage === OpportunityStage.Won &&
                  !opportunity.projectId
                    ? () => onConvert?.(opportunity)
                    : undefined
                }
                onMoveStage={(_, targetStage) =>
                  onMoveStage(opportunity.id, targetStage)
                }
                onAssign={() => onAssign(opportunity.id)}
                onScheduleFollowUp={() => onScheduleFollowUp(opportunity.id)}
                onTitleSave={onTitleSave}
                onLinkClient={onLinkClient}
                onCreateAndLinkClient={onCreateAndLinkClient}
                onAddressSave={onAddressSave}
              />
            );
          })}
          <FocusedListSummary summary={listSummary} stageColor={stageColor} />
        </div>
      ) : (
        <div
          className={`flex min-h-full flex-col items-start gap-3 ${FOCUSED_LIST_END_PADDING} pt-[24px]`}
        >
          <p className="font-mono text-caption-sm uppercase tracking-[0.16em] text-text">
            {emptyTitle}
          </p>
          <button
            type="button"
            className="rounded-chip border border-line px-3 py-2 font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={emptyActionHandler}
          >
            {emptyAction}
          </button>
          <FocusedListSummary summary={listSummary} stageColor={stageColor} />
        </div>
      )}
    </section>
  );
});

function FocusedListSummary({
  summary,
  stageColor,
}: {
  summary: string;
  stageColor: string;
}) {
  return (
    <div
      data-testid="pipeline-focused-list-summary"
      className="mt-3 flex w-full items-center gap-2 border-t border-border-subtle pt-3 font-mono text-micro uppercase tracking-[0.16em] tabular-nums text-text-mute"
    >
      <span
        aria-hidden="true"
        className="h-px w-6 shrink-0"
        style={{ backgroundColor: stageColor, opacity: 0.55 }}
      />
      <span>{summary}</span>
    </div>
  );
}

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
      <div className="flex h-full animate-pulse flex-col gap-2 pl-2 motion-reduce:animate-none">
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
