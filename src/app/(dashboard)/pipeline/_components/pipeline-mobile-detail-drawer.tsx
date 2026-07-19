"use client";

/**
 * OPS Web — full-screen lead detail for mobile web (< 900px).
 *
 * Below the desktop breakpoint the floating detail window never mounts, so a
 * card's "View details" wrote `detailPanelOpportunityId` into the mode store
 * and nothing happened (audit P1-4). This drawer is the mobile host for the
 * SAME `PipelineDetailBody` the window renders — the body is surface-agnostic
 * and is not forked here.
 *
 * Anatomy: `fixed inset-0` dense-glass sheet at `z-modal` (portaled to body so
 * no transformed ancestor can trap it), with a slim header — back chevron, the
 * lead's display name in the Cake Mono uppercase display voice, and the same
 * gated `PipelineDetailActionMenu` as the desktop window.
 *
 * Close paths: the back button, Escape (sparing open pickers / nested modals,
 * mirroring the window's guards), and the browser/hardware BACK gesture — the
 * drawer pushes one history sentinel on open and consumes it on close, so
 * "back" dismisses the sheet instead of leaving the pipeline.
 *
 * Focus: moves to the back button on open; restores to the element that was
 * focused before the drawer opened (the tapped card control) on close.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { Opportunity } from "@/lib/types/pipeline";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";
import { usePipelineModeStore } from "./pipeline-mode-store";
import {
  type DetailPanelActionHandlers,
  PipelineDetailActionMenu,
  PipelineDetailBody,
} from "./pipeline-detail-panel";

export interface PipelineMobileDetailDrawerProps
  extends DetailPanelActionHandlers {
  opportunity: Opportunity;
  leadAccess: LeadAccess;
}

/** History sentinel marker for the drawer's back-gesture integration. */
const HISTORY_SENTINEL = "ops-lead-drawer";

function getDisplayName(opportunity: Opportunity, fallback: string): string {
  return (
    opportunity.client?.name ??
    opportunity.contactName ??
    opportunity.title ??
    fallback
  );
}

export function PipelineMobileDetailDrawer({
  opportunity,
  leadAccess,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: PipelineMobileDetailDrawerProps) {
  const { t } = useDictionary("pipeline");
  const activeTab = usePipelineModeStore((s) => s.detailPanelActiveTab);
  const closeDetailPanel = usePipelineModeStore((s) => s.closeDetailPanel);
  const [mounted, setMounted] = useState(false);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreTargetRef = useRef<HTMLElement | null>(null);
  // True while our pushed history entry is still on the stack — popstate flips
  // it off; a UI-initiated close consumes it with one history.back().
  const sentinelActiveRef = useRef(false);
  const closedRef = useRef(false);

  const displayName = getDisplayName(opportunity, t("detail.unknown"));

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (sentinelActiveRef.current) {
      sentinelActiveRef.current = false;
      window.history.back();
    }
    closeDetailPanel();
    // Restore focus to the control that opened the drawer (the tapped card).
    const target = restoreTargetRef.current;
    if (target && target.isConnected) {
      target.focus({ preventScroll: true });
    }
  }, [closeDetailPanel]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Capture the opener + move focus in, once per mount.
  useEffect(() => {
    restoreTargetRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      backButtonRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // BACK-gesture integration: push one sentinel entry; popping it (hardware /
  // browser back) closes the drawer instead of leaving the pipeline.
  useEffect(() => {
    window.history.pushState({ [HISTORY_SENTINEL]: opportunity.id }, "");
    sentinelActiveRef.current = true;

    function handlePopState() {
      sentinelActiveRef.current = false;
      if (closedRef.current) return;
      closedRef.current = true;
      closeDetailPanel();
      const target = restoreTargetRef.current;
      if (target && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Deliberately DO NOT history.back() here. If the unmount is a route
      // navigation away from the pipeline, the sentinel is no longer the top
      // entry and back() would bounce the user to the page they just left.
      // A stale sentinel costs one silent back-press (it pops to the same
      // pipeline URL — a visual no-op); a bounce-back costs trust.
      sentinelActiveRef.current = false;
    };
  }, [closeDetailPanel, opportunity.id]);

  // Escape closes the drawer — unless a nested full-screen modal (photo
  // lightbox, deck viewer) or an open picker/editor owns that Escape. Same
  // guards as the desktop window.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (document.querySelector("[data-pipeline-detail-modal]")) return;
      if (
        document.querySelector(
          "[data-radix-popper-content-wrapper], [data-lead-field-editor]"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [close]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
      data-testid="pipeline-mobile-detail-drawer"
      data-keyboard-scope="modal-or-menu"
      className="glass-dense fixed inset-0 z-modal flex flex-col"
    >
      {/* Slim header: back · name · gated actions. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-glass-border px-1.5 py-1">
        <button
          ref={backButtonRef}
          type="button"
          aria-label={t("detail.back", "Back")}
          onClick={close}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded text-text-2",
            "transition-colors duration-150 hover:bg-surface-hover hover:text-text",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          )}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-cakemono text-[15px] font-light uppercase tracking-[0.04em] text-text">
          {displayName}
        </h2>
        {leadAccess.canEdit || leadAccess.canConvert ? (
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
        ) : null}
      </div>

      {/* The one shared detail body — not forked for mobile. */}
      <div className="min-h-0 flex-1">
        <PipelineDetailBody
          opportunity={opportunity}
          activeTab={activeTab}
          leadAccess={leadAccess}
          withRegion
        />
      </div>
    </div>,
    document.body
  );
}
