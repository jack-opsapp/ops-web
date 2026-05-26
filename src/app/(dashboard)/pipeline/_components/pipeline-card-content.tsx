"use client";

import { memo } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import type { Opportunity } from "@/lib/types/pipeline";
import {
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { formatTimeAgo } from "@/lib/utils/date";
import { PipelineCardActions } from "./pipeline-card-actions";

type PipelineCardDensity = "compact" | "comfortable";

export type PipelineCardActionHandlers = {
  onLogCall: () => void;
  onLogText: () => void;
  onAddNote: (note: string) => void;
  onArchive: () => void;
  onDiscard: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onAssign: () => void;
  onScheduleFollowUp: () => void;
  onOpenDetail: () => void;
};

export interface PipelineCardContentProps
  extends Partial<PipelineCardActionHandlers> {
  opportunity: Opportunity;
  clientName: string;
  stageColor: string;
  stalenessOpacity: number;
  density: PipelineCardDensity;
  surfaceVariant?: "default" | "focused";
  canManage?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  isExpanded?: boolean;
  openDetailLabel?: string;
  leadingAccessory?: React.ReactNode;
  quickStageActions?: React.ReactNode;
  children?: React.ReactNode;
}

const noop = () => {};

function withHexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${hex}${value.toString(16).padStart(2, "0").toUpperCase()}`;
}

export const PipelineCardContent = memo(function PipelineCardContent({
  opportunity,
  clientName,
  stageColor,
  stalenessOpacity,
  density,
  surfaceVariant = "default",
  canManage = false,
  isSelected = false,
  isHovered = false,
  isExpanded = false,
  openDetailLabel,
  leadingAccessory,
  quickStageActions,
  onLogCall = noop,
  onLogText = noop,
  onAddNote = noop,
  onArchive = noop,
  onDiscard = noop,
  onMarkWon = noop,
  onMarkLost = noop,
  onAssign = noop,
  onScheduleFollowUp = noop,
  onOpenDetail = noop,
  children,
}: PipelineCardContentProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();

  if (density === "compact") {
    const cardEdgeBorder = isSelected
      ? `2px solid ${stageColor}`
      : isHovered || isExpanded
        ? `1px solid ${stageColor}50`
        : "1px solid rgba(255,255,255,0.08)";

    return (
      <div
        className={cn(
          "w-full rounded-[4px]",
          !reduced && "transition-[border-color,box-shadow] duration-150"
        )}
        style={{
          background: "rgba(13,13,13,0.6)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderTop: cardEdgeBorder,
          borderRight: cardEdgeBorder,
          borderBottom: cardEdgeBorder,
          borderLeft: `3px solid ${stageColor}`,
          boxShadow: isSelected ? `0 0 12px ${stageColor}40` : undefined,
          padding: "8px 10px",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mohave text-body-sm font-medium text-text truncate">
            {clientName}
          </span>
          <span className="font-mohave text-body-sm text-text-2 whitespace-nowrap">
            {opportunity.estimatedValue
              ? formatCurrency(opportunity.estimatedValue)
              : "$--"}
          </span>
        </div>

        {children}
      </div>
    );
  }

  const displayTitle = opportunity.title || clientName;
  const stageName = getStageDisplayName(opportunity.stage);
  const daysInStage = getDaysInStage(opportunity);
  const activeSurface = isHovered || isExpanded;
  const clampedStaleness = Math.max(0, Math.min(1, stalenessOpacity));
  const staleSurfaceOpacity = activeSurface ? 0 : (1 - clampedStaleness) * 0.28;
  const isFocusedSurface = surfaceVariant === "focused";
  const stageBorderColor = activeSurface
    ? stageColor
    : withHexAlpha(stageColor, 0.45 + clampedStaleness * 0.55);
  const focusedStageWash = activeSurface
    ? withHexAlpha(stageColor, 0.1)
    : withHexAlpha(stageColor, 0.055);
  const lastCorrespondence = [
    opportunity.lastInboundAt,
    opportunity.lastOutboundAt,
  ]
    .filter(Boolean)
    .sort((a, b) => b!.getTime() - a!.getTime())[0];

  return (
    <div
      data-pipeline-card-shell={isFocusedSurface ? "focused" : undefined}
      className={cn(
        "glass-surface relative w-full overflow-hidden rounded-panel [&::before]:rounded-panel",
        !reduced && "transition-[border-color] duration-150"
      )}
      style={{
        background: isFocusedSurface
          ? `linear-gradient(180deg, ${focusedStageWash} 0%, var(--surface-glass) 34%, var(--surface-glass) 100%)`
          : undefined,
        borderLeft: isFocusedSurface
          ? undefined
          : `4px solid ${stageBorderColor}`,
        borderColor: isFocusedSurface
          ? activeSurface
            ? "rgba(255,255,255,0.18)"
            : "rgba(255,255,255,0.10)"
          : undefined,
      }}
    >
      {isFocusedSurface ? (
        <span
          aria-hidden="true"
          data-pipeline-card-stage-accent=""
          className="pointer-events-none absolute left-2 right-2 top-0 z-[1] h-px"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${withHexAlpha(stageColor, activeSurface ? 0.8 : 0.48)} 16%, ${withHexAlpha(stageColor, activeSurface ? 0.42 : 0.18)} 52%, transparent 100%)`,
          }}
        />
      ) : null}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-background",
          !reduced && "transition-opacity duration-150"
        )}
        style={{ opacity: staleSurfaceOpacity }}
      />

      <div className="relative z-[1] flex min-w-0">
        {leadingAccessory ? (
          <div className="flex w-12 shrink-0 items-center justify-center py-2 pl-1">
            {leadingAccessory}
          </div>
        ) : null}

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-1 p-2",
            isFocusedSurface && "gap-1.5 px-2.5 py-2.5",
            leadingAccessory ? "pl-1" : "pl-3",
            isFocusedSurface && leadingAccessory && "pl-1.5"
          )}
        >
          <button
            type="button"
            data-opportunity-card-id={opportunity.id}
            aria-label={openDetailLabel ?? t("card.viewDetails")}
            className="block w-full rounded-sm text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetail();
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-cakemono text-caption-sm font-light uppercase text-text">
                  {displayTitle}
                </p>
                <p className="truncate font-mohave text-body-sm text-text-2">
                  {clientName}
                </p>
              </div>
              <span className="shrink-0 font-mono text-data-sm text-text">
                {opportunity.estimatedValue
                  ? formatCurrency(opportunity.estimatedValue)
                  : "—"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1 border-t border-line pt-1">
              <Metric label={stageName} value={`${daysInStage}d`} />
              <Metric
                label={t("spatial.emailCount", "{count} emails").replace(
                  "{count}",
                  String(opportunity.correspondenceCount)
                )}
                value={
                  lastCorrespondence
                    ? formatTimeAgo(lastCorrespondence)
                    : "—"
                }
              />
              <Metric
                label={t("card.followUpDate", "Follow up {date}").replace(
                  "{date}",
                  ""
                )}
                value={
                  opportunity.nextFollowUpAt
                    ? formatTimeAgo(opportunity.nextFollowUpAt)
                    : "—"
                }
              />
            </div>
          </button>

          <PipelineCardActions
            opportunityId={opportunity.id}
            stage={opportunity.stage}
            canManage={canManage}
            stageActions={quickStageActions}
            onLogCall={onLogCall}
            onLogText={onLogText}
            onAddNote={onAddNote}
            onArchive={onArchive}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onDiscard={onDiscard}
            onAssign={onAssign}
            onScheduleFollowUp={onScheduleFollowUp}
            onOpenDetail={onOpenDetail}
          />
        </div>
      </div>
    </div>
  );
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-mono text-micro uppercase text-text-3">
        {label}
      </p>
      <p className="truncate font-mono text-data-sm text-text-2">{value}</p>
    </div>
  );
}
