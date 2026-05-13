"use client";

import { memo, useMemo, type CSSProperties } from "react";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
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

export interface PipelineFocusedColumnProps
  extends FocusedColumnActionHandlers {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  clientNameMap: Map<string, string>;
  canManage: boolean;
  filtersActive: boolean;
  focusedTabId: string;
  focusedPanelId: string;
  onAddLead: () => void;
  onClearFilters: () => void;
}

const NUMBER_STYLE: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

function averageDaysInStage(opportunities: Opportunity[]): number | null {
  if (opportunities.length === 0) return null;
  const totalDays = opportunities.reduce(
    (sum, opportunity) => sum + getDaysInStage(opportunity),
    0
  );
  return Math.round(totalDays / opportunities.length);
}

export const PipelineFocusedColumn = memo(function PipelineFocusedColumn({
  stage,
  opportunities,
  clientNameMap,
  canManage,
  filtersActive,
  focusedTabId,
  focusedPanelId,
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
  const stageName = getStageDisplayName(stage);
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage] ?? "#8F9AA3";
  const totalEstimatedValue = useMemo(
    () =>
      opportunities.reduce(
        (sum, opportunity) => sum + (opportunity.estimatedValue ?? 0),
        0
      ),
    [opportunities]
  );
  const avgDays = useMemo(
    () => averageDaysInStage(opportunities),
    [opportunities]
  );
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
    <section className="relative h-full w-full min-w-0">
      <header className="glass-dense absolute left-0 right-0 top-[clamp(144px,16vh,168px)] z-[2] isolate min-h-[88px] overflow-hidden px-4 py-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ops-accent">
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-0 top-3 w-[2px]"
          style={{ backgroundColor: stageColor }}
        />

        <div className="relative z-[1] flex min-h-[62px] items-end justify-between gap-4">
          <button
            type="button"
            role="tab"
            id={focusedTabId}
            aria-selected={true}
            aria-controls={focusedPanelId}
            tabIndex={0}
            className="min-w-0 truncate rounded-[5px] text-left font-cakemono text-[28px] font-light uppercase leading-none text-text focus-visible:outline-none"
          >
            {stageName}
          </button>

          <dl className="grid w-[280px] shrink-0 grid-cols-3 gap-2">
            <Metric
              label={t("focused.metrics.count", "COUNT")}
              value={String(opportunities.length)}
            />
            <Metric
              label={t("focused.metrics.value", "VALUE")}
              value={formatCurrency(totalEstimatedValue)}
            />
            <Metric
              label={t("focused.metrics.avgDays", "AVG DAYS")}
              value={avgDays === null ? "—" : `${avgDays}d`}
            />
          </dl>
        </div>
      </header>

      <div
        id={focusedPanelId}
        role="tabpanel"
        aria-labelledby={focusedTabId}
        className="h-full min-h-0 overflow-y-auto pr-1 pt-[clamp(244px,26vh,272px)] scrollbar-hide"
      >
        {opportunities.length > 0 ? (
          <div className="flex min-h-full flex-col gap-2 pb-[88px]">
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
          <div className="flex min-h-full flex-col items-start gap-3 pb-[88px] pt-[24px]">
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
      </div>
    </section>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate font-mono text-micro uppercase text-text-3">
        {label}
      </dt>
      <dd className="truncate font-mono text-data-sm text-text" style={NUMBER_STYLE}>
        {value}
      </dd>
    </div>
  );
}
