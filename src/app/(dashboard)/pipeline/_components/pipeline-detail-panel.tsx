"use client";

/**
 * Deal-detail building blocks shared by `PipelineFocusedDetailWindow` — the
 * ONE deal-detail surface (both pipeline modes float it via the window store).
 * The standalone `PipelineDetailPanel` drawer that used to live here served
 * the retired spatial mode; PR #73 removed its last render and the dead
 * component was excised when table mode was wired to the floating window
 * (2026-07-02).
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { type Opportunity, isActiveStage } from "@/lib/types/pipeline";
import type { LucideIcon } from "lucide-react";
import type { DetailTabId } from "./pipeline-mode-types";
import { PipelineDetailCorrespondenceTab } from "./pipeline-detail-correspondence-tab";
import { PipelineDetailNextSteps } from "./pipeline-detail-next-steps";
import { PipelineDetailPhotosTab } from "./pipeline-detail-photos-tab";
import { PipelineDetailTabBar } from "./pipeline-detail-tab-bar";
import { PipelineDetailTimelineTab } from "./pipeline-detail-timeline-tab";
import { LeadMapBand } from "./lead-map-band";
import { PipelineDetailOverviewTab } from "./pipeline-detail-overview-tab";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";
import { useOpportunityAssignedContext } from "@/lib/hooks/use-opportunity-assigned-context";

export type DetailPanelActionHandlers = {
  onAdvanceStage: (opportunity: Opportunity) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onDelete: (id: string) => void;
};

export function PipelineDetailBody({
  opportunity,
  activeTab,
  leadAccess,
  withRegion = false,
}: {
  opportunity: Opportunity;
  activeTab: DetailTabId;
  leadAccess: LeadAccess;
  withRegion?: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const assignedContextQuery = useOpportunityAssignedContext(opportunity.id);
  // TanStack retains prior data after a background refetch error. Never render
  // that stale snapshot while authorization is being rechecked or has failed.
  const assignedContext =
    assignedContextQuery.isError || assignedContextQuery.isFetching
      ? null
      : (assignedContextQuery.data ?? null);

  return (
    <div
      role={withRegion ? "region" : undefined}
      aria-label={
        withRegion
          ? t("focused.detailPanel.label", "Deal detail panel")
          : undefined
      }
      data-keyboard-scope="modal-or-menu"
      tabIndex={withRegion ? -1 : undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <LeadMapBand
        opportunity={opportunity}
        canManage={leadAccess.canEdit}
        canAssign={leadAccess.canAssign}
      />
      <PipelineDetailNextSteps
        opportunity={opportunity}
        followUps={assignedContext?.followUps ?? []}
        siteVisits={assignedContext?.siteVisits ?? []}
        canManage={leadAccess.canEdit}
      />
      <PipelineDetailTabBar />

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "overview" && (
          <PipelineDetailOverviewTab
            opportunity={opportunity}
            canManage={leadAccess.canEdit}
            assignedContext={assignedContext}
          />
        )}
        {activeTab === "correspondence" && (
          <PipelineDetailCorrespondenceTab
            activities={assignedContext?.activities ?? []}
            correspondence={assignedContext?.correspondence ?? []}
            contactName={assignedContext?.contact.name ?? null}
          />
        )}
        {activeTab === "timeline" && (
          <PipelineDetailTimelineTab
            activities={assignedContext?.activities ?? []}
          />
        )}
        {activeTab === "photos" && (
          <PipelineDetailPhotosTab
            opportunity={opportunity}
            canManage={leadAccess.canEdit}
          />
        )}
      </div>
    </div>
  );
}

export const PipelineDetailActionMenu = memo(function PipelineDetailActionMenu({
  opportunity,
  leadAccess,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: {
  opportunity: Opportunity;
  leadAccess: LeadAccess;
} & DetailPanelActionHandlers) {
  const { t } = useDictionary("pipeline");
  const [showActions, setShowActions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = isActiveStage(opportunity.stage);

  useEffect(() => {
    if (!showActions) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setShowActions(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showActions]);

  const runAction = useCallback((callback: () => void) => {
    setShowActions(false);
    callback();
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label={t("detail.stageActions")}
        aria-expanded={showActions}
        onClick={() => setShowActions((current) => !current)}
        className="flex h-7 w-7 items-center justify-center rounded text-text-3 transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {showActions && (
        <div
          data-keyboard-scope="modal-or-menu"
          className="glass-dense absolute right-0 top-full z-10 mt-1 min-w-[168px] rounded-modal border border-border p-1"
        >
          {active && leadAccess.canEdit && (
            <ActionItem
              icon={ChevronRight}
              label={t("detail.advance")}
              onClick={() => runAction(() => onAdvanceStage(opportunity))}
            />
          )}
          {leadAccess.canConvert ? (
            <ActionItem
              icon={Trophy}
              label={t("detail.won")}
              onClick={() => runAction(() => onMarkWon(opportunity))}
            />
          ) : null}
          {leadAccess.canEdit ? (
            <>
              <ActionItem
                icon={XCircle}
                label={t("detail.lost")}
                onClick={() => runAction(() => onMarkLost(opportunity))}
              />
              <ActionItem
                icon={XCircle}
                label={t("actions.discard")}
                onClick={() => runAction(() => onDiscard(opportunity.id))}
              />
              <div className="my-0.5 border-t border-border-subtle" />
              <ActionItem
                icon={Archive}
                label={t("actions.archive")}
                onClick={() => runAction(() => onArchive(opportunity.id))}
              />
              <ActionItem
                icon={Trash2}
                label={t("actions.delete")}
                destructive
                onClick={() => runAction(() => onDelete(opportunity.id))}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
});

function ActionItem({
  icon: Icon,
  label,
  destructive = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mohave text-[11px] transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
        destructive ? "text-ops-error" : "text-text-2"
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
