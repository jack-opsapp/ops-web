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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  type Opportunity,
  OpportunityStage,
  isActiveStage,
  nextOpportunityStage,
} from "@/lib/types/pipeline";
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
import { OpportunityAssignedContextError } from "@/lib/api/services/opportunity-assigned-context-service";

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
  // Denied is the ONE error that redacts synchronously — authorization was
  // confirmed revoked, so any retained payload must never render. Every other
  // state keeps last-good data: background refetches (window refocus, access
  // rechecks) and transient read failures hold the truth on screen instead of
  // blanking the panel to misleading empty states.
  const contextDenied =
    assignedContextQuery.isError &&
    assignedContextQuery.error instanceof OpportunityAssignedContextError &&
    assignedContextQuery.error.code === "access_denied";
  const assignedContext = contextDenied
    ? null
    : (assignedContextQuery.data ?? null);
  // First load only (fetching with nothing to show yet) — a disabled query
  // (no view scope) is NOT loading; it renders the redacted shape instead.
  const contextLoading = assignedContextQuery.isLoading;
  // A settled non-denied failure. With last-good data we keep rendering it
  // under an advisory row; with nothing to show, the row replaces the tab
  // content so Contact/Linked can never claim "[ no contact ]" about a lead
  // whose context simply failed to load.
  const contextFailed = assignedContextQuery.isError && !contextDenied;

  return (
    <div
      role={withRegion ? "region" : undefined}
      aria-label={
        withRegion
          ? t("focused.detailPanel.label", "Deal detail panel")
          : undefined
      }
      data-keyboard-scope="modal-or-menu"
      aria-busy={contextLoading ? true : undefined}
      tabIndex={withRegion ? -1 : undefined}
      className="flex h-full min-h-0 flex-col"
    >
      <LeadMapBand
        opportunity={opportunity}
        canManage={leadAccess.canEdit}
        canAssign={leadAccess.canAssign}
      />
      {/* Hidden during first load — an empty "no pending actions" claim about
          a lead whose context hasn't arrived yet would be a lie. */}
      {!contextLoading ? (
        <PipelineDetailNextSteps
          opportunity={opportunity}
          followUps={assignedContext?.followUps ?? []}
          siteVisits={assignedContext?.siteVisits ?? []}
          canManage={leadAccess.canEdit}
        />
      ) : null}
      <PipelineDetailTabBar />

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-3">
        {contextLoading ? (
          <DetailContextSkeleton />
        ) : (
          <>
            {contextFailed ? (
              <DetailContextErrorRow
                retrying={assignedContextQuery.isFetching}
                onRetry={() => {
                  void assignedContextQuery.refetch();
                }}
              />
            ) : null}
            {/* A failed read with no retained data has no truth to show —
                the advisory row above stands alone. */}
            {contextFailed && !assignedContext ? null : (
              <>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * First-load placeholder for the guarded context — quiet pulse rows on the
 * neutral fill token (mirrors `PipelineSkeleton`), reduced-motion aware. No
 * copy: a skeleton that names sections it can't vouch for would be guessing.
 */
function DetailContextSkeleton() {
  return (
    <div
      data-testid="detail-context-loading"
      aria-hidden="true"
      className="space-y-3"
    >
      <div className="h-[14px] w-[120px] animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="space-y-1.5">
        <div className="h-[12px] w-full animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
        <div className="h-[12px] w-4/5 animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
      </div>
      <div className="h-[14px] w-[88px] animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
      <div className="space-y-1.5">
        <div className="h-[12px] w-3/5 animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
        <div className="h-[12px] w-2/5 animate-pulse rounded bg-fill-neutral-dim motion-reduce:animate-none" />
      </div>
    </div>
  );
}

/**
 * Settled non-denied failure advisory: the guarded context read failed, so the
 * record below (if any) is last-good, not live. Rose is semantic error tone;
 * RETRY is a quiet ghost action wired to the query's refetch.
 */
function DetailContextErrorRow({
  retrying,
  onRetry,
}: {
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useDictionary("pipeline");
  return (
    <div
      data-testid="detail-context-error"
      role="alert"
      className="mb-3 flex items-center justify-between gap-2 rounded border border-border-subtle px-2 py-1.5"
    >
      <span className="min-w-0 truncate font-mono text-micro uppercase tracking-[0.14em] text-rose">
        {t("detail.contextError", "// ERROR — COULDN'T LOAD LEAD CONTEXT")}
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={cn(
          "shrink-0 rounded border border-glass-border px-2 py-0.5",
          "font-mono text-micro uppercase tracking-[0.14em] text-text-2",
          "transition-colors duration-150 hover:bg-surface-hover hover:text-text",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
          "disabled:cursor-wait disabled:opacity-40"
        )}
      >
        {t("detail.contextRetry", "RETRY")}
      </button>
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
  // Delete is irreversible and one tap from a hover menu — interpose a confirm.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = isActiveStage(opportunity.stage);
  const nextStage = nextOpportunityStage(opportunity.stage);
  const canAdvance =
    active &&
    leadAccess.canEdit &&
    (nextStage !== OpportunityStage.Won || leadAccess.canConvert);
  const leadName =
    opportunity.title?.trim() ||
    opportunity.client?.name ||
    opportunity.contactName ||
    t("detail.deleteName", "this lead");

  useEffect(() => {
    if (!showActions) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setShowActions(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setShowActions(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
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
          data-pipeline-detail-action-menu
          data-keyboard-scope="modal-or-menu"
          className="glass-dense absolute right-0 top-full z-10 mt-1 min-w-[168px] rounded-modal border border-border p-1"
        >
          {canAdvance && (
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
                onClick={() => runAction(() => setConfirmingDelete(true))}
              />
            </>
          ) : null}
        </div>
      )}

      {/* Delete confirm — z-modal on panel + overlay: this menu lives inside the
          floating detail window (z 2000+), above the kit's default dialog layer. */}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent className="z-modal" overlayClassName="z-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("detail.deleteTitle", "DELETE LEAD")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "detail.deleteBody",
                "This removes {name} from the pipeline. DESTRUCTIVE. NO UNDO."
              ).replace("{name}", leadName)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("detail.deleteCancel", "KEEP")}
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={() => {
                setConfirmingDelete(false);
                onDelete(opportunity.id);
              }}
            >
              {t("detail.deleteConfirm", "DELETE")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
