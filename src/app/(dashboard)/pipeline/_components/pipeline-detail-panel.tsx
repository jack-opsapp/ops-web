"use client";

import {
  memo,
  useCallback,
  useEffect,
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  ChevronRight,
  Mail,
  MoreHorizontal,
  Phone,
  Trash2,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  formatCurrency,
  getDaysInStage,
  getStageDisplayName,
  isActiveStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import type { LucideIcon } from "lucide-react";
import type { DetailTabId } from "./pipeline-mode-types";
import { usePipelineModeStore } from "./pipeline-mode-store";
import { PipelineDetailCorrespondenceTab } from "./pipeline-detail-correspondence-tab";
import { PipelineDetailNextSteps } from "./pipeline-detail-next-steps";
import { PipelineDetailPhotosTab } from "./pipeline-detail-photos-tab";
import { PipelineDetailTabBar } from "./pipeline-detail-tab-bar";
import { PipelineDetailTimelineTab } from "./pipeline-detail-timeline-tab";

export type DetailPanelActionHandlers = {
  onAdvanceStage: (opportunity: Opportunity) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onDelete: (id: string) => void;
};

export interface PipelineDetailPanelProps extends DetailPanelActionHandlers {
  opportunity: Opportunity;
  canManage: boolean;
  originatingOpportunityId: string | null;
  scopeRef: RefObject<HTMLElement | null>;
  className?: string;
}

type Bounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];
const REDUCED_MOTION_DURATION = 0.001;
const DRAWER_WIDTH = 420;
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function readBounds(element: HTMLElement | null): Bounds | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: window.innerWidth - rect.right,
    bottom: window.innerHeight - rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function focusOrigin(originatingOpportunityId: string | null) {
  if (!originatingOpportunityId) return;

  const target = document.querySelector<HTMLElement>(
    `[data-opportunity-card-id="${escapeAttributeValue(originatingOpportunityId)}"]`
  );
  target?.focus({ preventScroll: true });
}

export const PipelineDetailPanel = memo(function PipelineDetailPanel({
  opportunity,
  canManage,
  originatingOpportunityId,
  scopeRef,
  className,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: PipelineDetailPanelProps) {
  const reduced = useReducedMotion();
  const mode = usePipelineModeStore((s) => s.mode);
  const detailPanelOpportunityId = usePipelineModeStore(
    (s) => s.detailPanelOpportunityId
  );
  const activeTab = usePipelineModeStore((s) => s.detailPanelActiveTab);
  const closeDetailPanel = usePipelineModeStore((s) => s.closeDetailPanel);
  const [mounted, setMounted] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const shouldUsePortal = mode === "focused";
  const activeOrigin = originatingOpportunityId ?? detailPanelOpportunityId;

  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => focusOrigin(activeOrigin));
  }, [activeOrigin]);

  const handleClose = useCallback(() => {
    closeDetailPanel();
    restoreFocus();
  }, [closeDetailPanel, restoreFocus]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!shouldUsePortal) return;

    const syncBounds = () => {
      setBounds(readBounds(scopeRef.current));
    };

    syncBounds();
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);

    return () => {
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);
    };
  }, [scopeRef, shouldUsePortal]);

  useEffect(() => {
    if (shouldUsePortal && (!mounted || !bounds)) return;

    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? panel).focus({ preventScroll: true });
    });
  }, [bounds, detailPanelOpportunityId, mounted, shouldUsePortal]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  const panel = (
    <PanelSurface
      ref={panelRef}
      opportunity={opportunity}
      canManage={canManage}
      activeTab={activeTab}
      className={className}
      onClose={handleClose}
      onAdvanceStage={onAdvanceStage}
      onMarkWon={onMarkWon}
      onMarkLost={onMarkLost}
      onArchive={onArchive}
      onDiscard={onDiscard}
      onDelete={onDelete}
    />
  );

  if (!shouldUsePortal) {
    return (
      <motion.div
        layout={!reduced}
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12 }}
        transition={{
          duration: reduced ? REDUCED_MOTION_DURATION : 0.24,
          ease: EASE_SMOOTH,
        }}
        className="h-full min-h-0 w-full"
      >
        {panel}
      </motion.div>
    );
  }

  if (!mounted || !bounds) return null;

  const drawerWidth = Math.min(DRAWER_WIDTH, Math.max(320, bounds.width));
  const drawerStyle = {
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: drawerWidth,
    zIndex: 1500,
  };
  const backdropStyle = {
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    left: bounds.left,
    zIndex: 1499,
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="pipeline-detail-panel-backdrop"
        className="fixed bg-background/40"
        style={backdropStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: reduced ? REDUCED_MOTION_DURATION : 0.24,
          ease: EASE_SMOOTH,
        }}
        onClick={handleClose}
      />
      <motion.aside
        key="pipeline-detail-panel-drawer"
        className="fixed"
        style={drawerStyle}
        initial={reduced ? { opacity: 0 } : { x: 420 }}
        animate={reduced ? { opacity: 1 } : { x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: 420 }}
        transition={{
          duration: reduced ? REDUCED_MOTION_DURATION : 0.24,
          ease: EASE_SMOOTH,
        }}
      >
        {panel}
      </motion.aside>
    </AnimatePresence>,
    document.body
  );
});

type PanelSurfaceProps = DetailPanelActionHandlers & {
  opportunity: Opportunity;
  canManage: boolean;
  activeTab: DetailTabId;
  className?: string;
  onClose: () => void;
};

const PanelSurface = memo(
  forwardRef<HTMLElement, PanelSurfaceProps>(function PanelSurface(
    {
      opportunity,
      canManage,
      activeTab,
      className,
      onClose,
      onAdvanceStage,
      onMarkWon,
      onMarkLost,
      onArchive,
      onDiscard,
      onDelete,
    },
    ref
  ) {
    const { t } = useDictionary("pipeline");

    return (
      <section
        ref={ref}
        role="region"
        aria-label={t("focused.detailPanel.label", "Deal detail panel")}
        tabIndex={-1}
        className={cn(
          "glass-dense flex h-full min-h-0 w-full flex-col overflow-hidden rounded-modal border border-border",
          className
        )}
      >
        <PipelineDetailHeader
          opportunity={opportunity}
          canManage={canManage}
          onClose={onClose}
          onAdvanceStage={onAdvanceStage}
          onMarkWon={onMarkWon}
          onMarkLost={onMarkLost}
          onArchive={onArchive}
          onDiscard={onDiscard}
          onDelete={onDelete}
        />

        <PipelineDetailBody opportunity={opportunity} activeTab={activeTab} />
      </section>
    );
  })
);

PanelSurface.displayName = "PanelSurface";

export function PipelineDetailBody({
  opportunity,
  activeTab,
  withRegion = false,
  headerSlot,
}: {
  opportunity: Opportunity;
  activeTab: DetailTabId;
  withRegion?: boolean;
  headerSlot?: ReactNode;
}) {
  const { t } = useDictionary("pipeline");

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
      {headerSlot}
      <PipelineDetailNextSteps
        opportunityId={opportunity.id}
        opportunity={opportunity}
      />
      <PipelineDetailTabBar />

      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "correspondence" && (
          <PipelineDetailCorrespondenceTab opportunityId={opportunity.id} />
        )}
        {activeTab === "timeline" && (
          <PipelineDetailTimelineTab opportunityId={opportunity.id} />
        )}
        {activeTab === "photos" && (
          <PipelineDetailPhotosTab opportunityId={opportunity.id} />
        )}
      </div>
    </div>
  );
}

const PipelineDetailHeader = memo(function PipelineDetailHeader({
  opportunity,
  canManage,
  onClose,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: {
  opportunity: Opportunity;
  canManage: boolean;
  onClose: () => void;
} & DetailPanelActionHandlers) {
  const { t } = useDictionary("pipeline");

  const stageName = getStageDisplayName(opportunity.stage);
  const stageColor =
    OPPORTUNITY_STAGE_COLORS[opportunity.stage] ?? "var(--text-3)";
  const displayName =
    opportunity.client?.name ??
    opportunity.contactName ??
    opportunity.title ??
    t("detail.unknown");
  const titleText =
    opportunity.title && opportunity.title !== displayName
      ? `${displayName} — ${opportunity.title}`
      : displayName;
  const daysInStage = getDaysInStage(opportunity);

  return (
    <header className="relative shrink-0 border-b border-border-subtle px-3 py-2">
      <span
        aria-hidden="true"
        className="absolute bottom-2 left-0 top-2 w-[2px]"
        style={{ backgroundColor: stageColor }}
      />

      <div className="flex min-w-0 items-start justify-between gap-3 pl-2">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-cakemono text-cake-button font-light uppercase text-text">
            {titleText}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-micro text-text-mute">
            <span className="uppercase text-text-3">{stageName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {daysInStage}
              {t("detail.daysInStage")}
            </span>
            {opportunity.estimatedValue != null && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-text-2">
                  {formatCurrency(opportunity.estimatedValue)}
                </span>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {opportunity.contactPhone && (
              <a
                href={`tel:${opportunity.contactPhone}`}
                className="flex min-w-0 items-center gap-1 font-mono text-micro text-text-3 transition-colors hover:text-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
              >
                <Phone className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{opportunity.contactPhone}</span>
              </a>
            )}
            {opportunity.contactEmail && (
              <a
                href={`mailto:${opportunity.contactEmail}`}
                className="flex min-w-0 items-center gap-1 font-mono text-micro text-text-3 transition-colors hover:text-text-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
              >
                <Mail className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{opportunity.contactEmail}</span>
              </a>
            )}
            {!opportunity.contactPhone && !opportunity.contactEmail && (
              <span className="font-mono text-micro text-text-mute">
                {t("detail.noContact")}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canManage && (
            <PipelineDetailActionMenu
              opportunity={opportunity}
              onAdvanceStage={onAdvanceStage}
              onMarkWon={onMarkWon}
              onMarkLost={onMarkLost}
              onArchive={onArchive}
              onDiscard={onDiscard}
              onDelete={onDelete}
            />
          )}

          <button
            type="button"
            aria-label={t("focused.detailPanel.close", "Close detail panel")}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {opportunity.aiSummary && (
        <p className="mt-2 pl-2 font-mono text-micro leading-[1.6] text-text-mute">
          {opportunity.aiSummary}
        </p>
      )}
    </header>
  );
});

export const PipelineDetailActionMenu = memo(function PipelineDetailActionMenu({
  opportunity,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDiscard,
  onDelete,
}: {
  opportunity: Opportunity;
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
          {active && (
            <ActionItem
              icon={ChevronRight}
              label={t("detail.advance")}
              onClick={() => runAction(() => onAdvanceStage(opportunity))}
            />
          )}
          <ActionItem
            icon={Trophy}
            label={t("detail.won")}
            onClick={() => runAction(() => onMarkWon(opportunity))}
          />
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
