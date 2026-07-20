"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
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
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";

export interface PipelineFocusedDetailWindowProps extends DetailPanelActionHandlers {
  opportunity: Opportunity;
  leadAccess: LeadAccess;
  originatingOpportunityId: string | null;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// The exact, shallow-compared slice of a window's store record this component
// depends on. Selecting the whole window object re-rendered (and re-ran the
// focus effect) on every unrelated store write; this narrow view is stable
// across bring-to-front / drag churn because each field only changes when it
// genuinely changes.
interface DetailWindowView {
  exists: boolean;
  isMinimized: boolean;
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  zIndex: number;
}

const CLOSED_WINDOW_VIEW: DetailWindowView = {
  exists: false,
  isMinimized: false,
  position: null,
  size: null,
  zIndex: 0,
};

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

export function getOpportunityTitle(
  opportunity: Opportunity,
  fallback: string
) {
  const displayName =
    opportunity.client?.name ??
    opportunity.contactName ??
    opportunity.title ??
    fallback;

  const { title } = opportunity;
  if (!title || title === displayName) return displayName;
  // Auto-named / user-named leads whose title already leads with the display
  // name (client "North Shore Decks" + title "North Shore Decks — deck rebuild")
  // would stutter the name in "{name} — {title}"; show the title alone instead.
  if (title.toLowerCase().startsWith(displayName.toLowerCase())) return title;
  return `${displayName} — ${title}`;
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
  leadAccess,
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
  const windowId = getPipelineDetailWindowId(opportunity.id);
  // Subscribe to a narrow, shallow-compared view instead of the whole window
  // record. `focusWindow` (bring-to-front) rebuilds the windows array — and
  // thus the window object identity — on EVERY in-window pointerdown. Reading
  // the whole object re-ran the focus effect on that churn and yanked focus out
  // of the open assignee popover (which, being non-modal, dismissed on
  // focus-out). Each field below is referentially stable across unrelated
  // writes, so the effects only fire on real transitions.
  const windowView = useWindowStore(
    useShallow((s): DetailWindowView => {
      const windowState = s.windows.find(
        (candidate) =>
          candidate.id === windowId && candidate.type === "pipeline-detail"
      );
      if (!windowState) return CLOSED_WINDOW_VIEW;
      return {
        exists: true,
        isMinimized: windowState.isMinimized,
        position: windowState.position,
        size: windowState.size,
        zIndex: windowState.zIndex,
      };
    })
  );
  const windowExists = windowView.exists;
  const windowMinimized = windowView.isMinimized;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hadWindowRef = useRef(false);
  const focusedForOpportunityRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);
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
    if (windowExists) {
      hadWindowRef.current = true;
      return;
    }

    if (!hadWindowRef.current) return;
    closeDetailPanel();
    restoreFocus();
  }, [closeDetailPanel, restoreFocus, windowExists]);

  useEffect(() => {
    if (!windowExists || windowMinimized) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      // The nested action menu owns the first Escape and closes itself. Its
      // capture listener stops propagation before the shell-level shortcut can
      // tear down this window.
      if (document.querySelector("[data-pipeline-detail-action-menu]")) return;
      // A nested full-screen modal (photo lightbox, deck viewer) owns this
      // Escape — it closes itself; the window stays. Without this guard the
      // capture-phase listener tears down the whole window underneath it.
      if (document.querySelector("[data-pipeline-detail-modal]")) return;
      // Destructive confirmations are portaled above this window. Radix owns
      // the first Escape while the alert is open; the lead window must remain
      // mounted underneath it.
      if (document.querySelector('[role="alertdialog"][data-state="open"]')) {
        return;
      }
      // An open picker owns Escape too: the Radix assignee popover
      // (`[data-radix-popper-content-wrapper]`) and the portaled inline field
      // editors (`[data-lead-field-editor]`) each close themselves on Escape.
      // Bailing here lets them handle it instead of collapsing the window.
      if (
        document.querySelector(
          "[data-radix-popper-content-wrapper], [data-lead-field-editor]"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleClose, windowExists, windowMinimized]);

  useEffect(() => {
    const isOpen = windowExists && !windowMinimized;
    if (!isOpen) {
      // Closed or minimized — clear the latch so the next open refocuses.
      focusedForOpportunityRef.current = null;
      return;
    }

    // Focus the body exactly once per open episode. Re-running on z-order or
    // position churn would steal focus back into the body and dismiss the
    // non-modal assignee popover the instant the operator clicks to open it.
    if (focusedForOpportunityRef.current === opportunity.id) return;
    focusedForOpportunityRef.current = opportunity.id;

    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (!body) return;
      const focusable = body.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? body).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [opportunity.id, windowExists, windowMinimized]);

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

  if (!mounted || !windowExists || windowMinimized) return null;
  // `exists` guarantees both are set; this narrows the nullable view fields for
  // the shell props below.
  const { position, size, zIndex } = windowView;
  if (!position || !size) return null;

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
        leadAccess.canEdit || leadAccess.canConvert ? (
          <PipelineDetailActionMenu
            opportunity={opportunity}
            leadAccess={leadAccess}
            onAdvanceStage={onAdvanceStage}
            onMarkWon={onMarkWon}
            onMarkLost={onMarkLost}
            onArchive={onArchive}
            onDiscard={onDiscard}
            onDelete={onDelete}
          />
        ) : undefined
      }
      position={position}
      size={size}
      zIndex={zIndex}
      footerConfig={footerConfig}
      onRequestClose={handleClose}
      keyboardScope="modal-or-menu"
    >
      <div ref={bodyRef} className="h-full min-h-0">
        <PipelineDetailBody
          opportunity={opportunity}
          activeTab={activeTab}
          leadAccess={leadAccess}
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
