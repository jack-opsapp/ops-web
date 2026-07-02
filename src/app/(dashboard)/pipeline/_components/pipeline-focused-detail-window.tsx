"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDictionary } from "@/i18n/client";
import { useWindowStore } from "@/stores/window-store";
import { ProjectWorkspaceWindow } from "@/components/ops/projects/workspace/shell/project-workspace-window";
import type { ModeFooterConfig } from "@/components/ops/projects/workspace/shell/mode-footer";
import type { ChipVariant } from "@/components/ops/projects/workspace/atoms/chip";
import {
  type Opportunity,
  OpportunityStage,
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import { usePipelineModeStore } from "./pipeline-mode-store";
import {
  type DetailPanelActionHandlers,
  PipelineDetailActionMenu,
  PipelineDetailBody,
} from "./pipeline-detail-panel";

export interface PipelineFocusedDetailWindowProps extends DetailPanelActionHandlers {
  opportunity: Opportunity;
  canManage: boolean;
  originatingOpportunityId: string | null;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function getPipelineDetailWindowId(opportunityId: string): string {
  return `pipeline-detail:${opportunityId}`;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function focusOrigin(originatingOpportunityId: string | null) {
  if (!originatingOpportunityId) return;

  // Double rAF: the first frame can still race the window's unmount commit —
  // if the portal (which holds focus) is removed AFTER we focus the origin,
  // the browser resets focus to <body> and the restore is lost. Waiting one
  // extra frame guarantees the removal has settled first.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const escaped = escapeAttributeValue(originatingOpportunityId);
      // Focused mode restores to the board card; table mode (which renders no
      // cards) falls back to the deal's row cell — every cell carries the
      // row-id attribute and a roving tabindex, so it is programmatically
      // focusable.
      const target =
        document.querySelector<HTMLElement>(
          `[data-opportunity-card-id="${escaped}"]`
        ) ??
        document.querySelector<HTMLElement>(
          `[data-pipeline-table-row-id="${escaped}"]`
        );
      target?.focus({ preventScroll: true });
    });
  });
}

function getOpportunityTitle(opportunity: Opportunity, fallback: string) {
  const displayName =
    opportunity.client?.name ??
    opportunity.contactName ??
    opportunity.title ??
    fallback;

  return opportunity.title && opportunity.title !== displayName
    ? `${displayName} — ${opportunity.title}`
    : displayName;
}

function stageTone(stage: OpportunityStage): ChipVariant {
  switch (stage) {
    case OpportunityStage.Won:
      return "olive";
    case OpportunityStage.Qualifying:
    case OpportunityStage.Quoting:
    case OpportunityStage.Quoted:
    case OpportunityStage.FollowUp:
    case OpportunityStage.Negotiation:
      return "tan";
    case OpportunityStage.Lost:
    case OpportunityStage.Discarded:
      return "rose";
    default:
      return "neutral";
  }
}

export function PipelineFocusedDetailWindow({
  opportunity,
  canManage,
  originatingOpportunityId,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: PipelineFocusedDetailWindowProps) {
  const { t } = useDictionary("pipeline");
  const activeTab = usePipelineModeStore((s) => s.detailPanelActiveTab);
  const closeDetailPanel = usePipelineModeStore((s) => s.closeDetailPanel);
  const openWindow = useWindowStore((s) => s.openWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const win = useWindowStore((s) =>
    s.windows.find(
      (windowState) =>
        windowState.id === getPipelineDetailWindowId(opportunity.id) &&
        windowState.type === "pipeline-detail"
    )
  );
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hadWindowRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const windowId = getPipelineDetailWindowId(opportunity.id);
  const title = getOpportunityTitle(opportunity, t("detail.unknown"));
  const stageName = getStageDisplayName(opportunity.stage);
  const stageLabel = stageName.toUpperCase();
  const projectIdLabel = opportunity.id.slice(0, 8).toUpperCase();
  const dockTitle = t("detail.windowDockTitle");

  const restoreFocus = useCallback(() => {
    focusOrigin(originatingOpportunityId);
  }, [originatingOpportunityId]);

  const handleClose = useCallback(() => {
    closeDetailPanel();
    closeWindow(windowId);
    restoreFocus();
  }, [closeDetailPanel, closeWindow, restoreFocus, windowId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    openWindow({
      id: windowId,
      title: dockTitle,
      type: "pipeline-detail",
      metadata: { opportunityId: opportunity.id },
    });

    return () => closeWindow(windowId);
  }, [closeWindow, dockTitle, openWindow, opportunity.id, windowId]);

  useEffect(() => {
    if (win) {
      hadWindowRef.current = true;
      return;
    }

    if (!hadWindowRef.current) return;
    closeDetailPanel();
    restoreFocus();
  }, [closeDetailPanel, restoreFocus, win]);

  useEffect(() => {
    if (!win || win.isMinimized) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleClose, win]);

  useEffect(() => {
    if (!win || win.isMinimized) return;

    requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (!body) return;
      const focusable = body.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? body).focus({ preventScroll: true });
    });
  }, [opportunity.id, win]);

  const footerConfig = useMemo<ModeFooterConfig>(() => {
    const meta = [
      opportunity.estimatedValue != null
        ? formatCurrency(opportunity.estimatedValue)
        : null,
      `${getDaysInStage(opportunity)}${t("detail.daysInStage")}`,
    ].filter(Boolean);

    return {
      secondary: [],
      meta:
        meta.length > 0 ? (
          <span className="font-mono text-micro uppercase text-text-3">
            {meta.join(" · ")}
          </span>
        ) : undefined,
    };
  }, [opportunity, t]);

  if (!mounted || !win || win.isMinimized) return null;

  return createPortal(
    <ProjectWorkspaceWindow
      id={windowId}
      title={title}
      subtitle={buildSubtitle(opportunity, t("detail.noContact"))}
      crumbLabel={t("detail.windowCrumb")}
      projectIdLabel={projectIdLabel}
      statusLabel={stageLabel}
      statusTone={stageTone(opportunity.stage)}
      mode="viewing"
      headerAction={
        canManage ? (
          <PipelineDetailActionMenu
            opportunity={opportunity}
            onAdvanceStage={onAdvanceStage}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onArchive={onArchive}
            onDiscard={onDiscard}
            onDelete={onDelete}
          />
        ) : undefined
      }
      position={win.position}
      size={win.size}
      zIndex={win.zIndex}
      footerConfig={footerConfig}
      onRequestClose={handleClose}
      keyboardScope="modal-or-menu"
    >
      <div ref={bodyRef} className="h-full min-h-0">
        <PipelineDetailBody
          opportunity={opportunity}
          activeTab={activeTab}
          canManage={canManage}
          withRegion
        />
      </div>
    </ProjectWorkspaceWindow>,
    document.body
  );
}

function buildSubtitle(opportunity: Opportunity, fallback: string): string {
  const parts = [
    opportunity.address,
    opportunity.contactPhone,
    opportunity.contactEmail,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : fallback;
}
