"use client";

import { useCallback, useRef, useState, memo, type MouseEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Minus,
  X,
  Phone,
  Mail,
  MoreHorizontal,
  Trophy,
  XCircle,
  Archive,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  type Opportunity,
  getStageDisplayName,
  getStageColor,
  getDaysInStage,
  formatCurrency,
  isActiveStage,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import {
  useDetailPopoverStore,
  type DetailPopoverState,
} from "./detail-popover-store";
import { DetailPopoverNextSteps } from "./detail-popover-next-steps";
import { DetailPopoverTabBar } from "./detail-popover-tab-bar";
import { DetailPopoverCorrespondenceTab } from "./detail-popover-correspondence-tab";
import { DetailPopoverTimelineTab } from "./detail-popover-timeline-tab";
import { DetailPopoverPhotosTab } from "./detail-popover-photos-tab";

// ── Easing ──
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];


// ── Props ──
interface DetailPopoverProps {
  popoverState: DetailPopoverState;
  opportunity: Opportunity;
  canManage: boolean;
  onAdvanceStage: () => void;
  onMarkWon: () => void;
  onMarkLost: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export const DetailPopover = memo(function DetailPopover({
  popoverState,
  opportunity,
  canManage,
  onAdvanceStage,
  onMarkWon,
  onMarkLost,
  onArchive,
  onDelete,
}: DetailPopoverProps) {
  const { t } = useDictionary("pipeline");
  const { company } = useAuthStore();
  const reduced = useReducedMotion();

  const {
    closePopover,
    minimizePopover,
    focusPopover,
    updatePosition,
    updateSize,
  } = useDetailPopoverStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const stageMenuRef = useRef<HTMLDivElement>(null);

  const stageColor = getStageColor(opportunity.stage);
  const stageName = getStageDisplayName(opportunity.stage);
  const daysInStage = getDaysInStage(opportunity);
  const active = isActiveStage(opportunity.stage);

  // ── Title text: client name — lead title ──
  const displayName =
    opportunity.client?.name ??
    opportunity.contactName ??
    opportunity.title;
  const hasDistinctTitle =
    opportunity.title &&
    opportunity.title !== displayName &&
    opportunity.title !== opportunity.contactName;
  const titleText = hasDistinctTitle
    ? `${displayName} — ${opportunity.title}`
    : displayName;

  // ── Drag handling (title bar) ──
  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusPopover(popoverState.id);
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - popoverState.position.x,
        y: e.clientY - popoverState.position.y,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newX = Math.max(0, Math.min(moveEvent.clientX - dragOffset.current.x, globalThis.innerWidth - popoverState.size.width));
        const newY = Math.max(0, Math.min(moveEvent.clientY - dragOffset.current.y, globalThis.innerHeight - popoverState.size.height));
        updatePosition(popoverState.id, { x: newX, y: newY });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [popoverState.id, popoverState.position, popoverState.size.width, popoverState.size.height, focusPopover, updatePosition]
  );

  // ── Resize handling (bottom-right corner) ──
  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusPopover(popoverState.id);
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: popoverState.size.width,
        h: popoverState.size.height,
      };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dw = moveEvent.clientX - resizeStart.current.x;
        const dh = moveEvent.clientY - resizeStart.current.y;
        updateSize(popoverState.id, {
          width: resizeStart.current.w + dw,
          height: resizeStart.current.h + dh,
        });
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [popoverState.id, popoverState.size, focusPopover, updateSize]
  );

  // ── Close stage menu on outside click ──
  const handleStageMenuToggle = useCallback(() => {
    setShowStageMenu((prev) => {
      if (!prev) {
        const handleOutsideClick = (e: globalThis.MouseEvent) => {
          if (stageMenuRef.current && !stageMenuRef.current.contains(e.target as Node)) {
            setShowStageMenu(false);
            document.removeEventListener("mousedown", handleOutsideClick);
          }
        };
        requestAnimationFrame(() => {
          document.addEventListener("mousedown", handleOutsideClick);
        });
      }
      return !prev;
    });
  }, []);

  if (popoverState.isMinimized) return null;

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      className={cn(
        "fixed flex flex-col overflow-hidden",
        "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2]",
        "border border-[rgba(255,255,255,0.08)] rounded-[4px]",
        (isDragging || isResizing) && "select-none"
      )}
      style={{
        left: popoverState.position.x,
        top: popoverState.position.y,
        width: popoverState.size.width,
        height: popoverState.size.height,
        zIndex: popoverState.zIndex,
      }}
      onMouseDown={() => focusPopover(popoverState.id)}
    >
      {/* ── Title bar ── */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)] cursor-grab shrink-0"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-1.5 h-1.5 rounded-[1px] shrink-0"
            style={{ backgroundColor: OPPORTUNITY_STAGE_COLORS[opportunity.stage] ?? "#BCBCBC" }}
          />
          <span className="font-mohave text-[13px] font-semibold text-text-primary truncate">
            {titleText}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {opportunity.estimatedValue != null && (
            <span className="font-mono text-[11px] text-text-secondary">
              {formatCurrency(opportunity.estimatedValue)}
            </span>
          )}
          <div className="flex items-center gap-[2px]">
            <button
              onClick={() => minimizePopover(popoverState.id)}
              className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={() => closePopover(popoverState.id)}
              className="w-5 h-5 rounded-[2px] flex items-center justify-center text-text-tertiary hover:text-ops-error hover:bg-ops-error-muted transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Info strip ── */}
      <div className="px-3 py-1.5 border-b border-[rgba(255,255,255,0.06)] shrink-0 space-y-1">
        {/* Row 1: contact phone + email */}
        <div className="flex items-center gap-2 min-w-0">
          {opportunity.contactPhone && (
            <a
              href={`tel:${opportunity.contactPhone}`}
              className="flex items-center gap-1 text-text-tertiary hover:text-ops-accent transition-colors shrink-0"
            >
              <Phone className="w-2.5 h-2.5" />
              <span className="font-kosugi text-[10px] whitespace-nowrap">
                {opportunity.contactPhone}
              </span>
            </a>
          )}
          {opportunity.contactPhone && opportunity.contactEmail && (
            <span className="text-[rgba(255,255,255,0.12)]">·</span>
          )}
          {opportunity.contactEmail && (
            <a
              href={`mailto:${opportunity.contactEmail}`}
              className="flex items-center gap-1 text-text-tertiary hover:text-ops-accent transition-colors min-w-0"
            >
              <Mail className="w-2.5 h-2.5 shrink-0" />
              <span className="font-kosugi text-[10px] truncate">
                {opportunity.contactEmail}
              </span>
            </a>
          )}
          {!opportunity.contactPhone && !opportunity.contactEmail && (
            <span className="font-kosugi text-[10px] text-text-disabled">
              {t("detail.noContact")}
            </span>
          )}
        </div>

        {/* Row 2: stage + days + overflow */}
        <div className="flex items-center gap-1.5" ref={stageMenuRef}>
          <span
            className="font-kosugi text-[9px] uppercase tracking-wide"
            style={{ color: stageColor }}
          >
            {stageName}
          </span>
          <span className="font-kosugi text-[9px] text-text-disabled">
            · {daysInStage}{t("detail.daysInStage")}
          </span>
          {canManage && active && (
            <div className="relative ml-auto">
              <button
                onClick={handleStageMenuToggle}
                className="w-4 h-4 rounded-[2px] flex items-center justify-center text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>

              {showStageMenu && (
                <div className="absolute top-full right-0 mt-1 z-50 min-w-[150px] bg-[rgba(10,10,10,0.95)] backdrop-blur-xl border border-[rgba(255,255,255,0.10)] rounded-[4px] p-1">
                  <button
                    onClick={() => { setShowStageMenu(false); onAdvanceStage(); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <ChevronRight className="w-3 h-3 shrink-0" />
                    {t("detail.advance")}
                  </button>
                  <button
                    onClick={() => { setShowStageMenu(false); onMarkWon(); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <Trophy className="w-3 h-3 shrink-0" />
                    {t("detail.won")}
                  </button>
                  <button
                    onClick={() => { setShowStageMenu(false); onMarkLost(); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <XCircle className="w-3 h-3 shrink-0" />
                    {t("detail.lost")}
                  </button>
                  <div className="border-t border-[rgba(255,255,255,0.06)] my-0.5" />
                  <button
                    onClick={() => { setShowStageMenu(false); onArchive(); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <Archive className="w-3 h-3 shrink-0" />
                    {t("actions.archive")}
                  </button>
                  <button
                    onClick={() => { setShowStageMenu(false); setShowDeleteConfirm(true); }}
                    className="flex items-center gap-2 w-full px-2 py-1.5 font-mohave text-[11px] text-ops-error/80 hover:bg-[rgba(255,255,255,0.06)] rounded-[2px] transition-colors"
                  >
                    <Trash2 className="w-3 h-3 shrink-0" />
                    {t("actions.delete")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Summary */}
        {opportunity.aiSummary && (
          <p className="font-kosugi text-[10px] text-text-disabled leading-[1.6] mt-1.5">
            {opportunity.aiSummary}
          </p>
        )}
      </div>

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)] shrink-0">
          <p className="font-kosugi text-[11px] text-text-secondary mb-2">
            {t("actions.deleteConfirm")}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 px-2 py-1.5 font-mohave text-[11px] uppercase tracking-[0.5px] text-text-secondary rounded-[2px] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              {t("transition.cancel")}
            </button>
            <button
              onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
              className="flex-1 px-2 py-1.5 font-mohave text-[11px] uppercase tracking-[0.5px] text-ops-error rounded-[2px] border border-ops-error/20 bg-ops-error/10 hover:bg-ops-error/15 transition-colors"
            >
              {t("actions.delete")}
            </button>
          </div>
        </div>
      )}

      {/* ── Next Steps ── */}
      <DetailPopoverNextSteps
        opportunityId={popoverState.id}
        opportunity={opportunity}
      />

      {/* ── Tab bar ── */}
      <DetailPopoverTabBar
        popoverId={popoverState.id}
        activeTab={popoverState.activeTab}
      />

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide p-3">
        {popoverState.activeTab === "correspondence" && (
          <DetailPopoverCorrespondenceTab opportunityId={popoverState.id} />
        )}
        {popoverState.activeTab === "timeline" && (
          <DetailPopoverTimelineTab opportunityId={popoverState.id} />
        )}
        {popoverState.activeTab === "photos" && (
          <DetailPopoverPhotosTab opportunityId={popoverState.id} />
        )}
      </div>

      {/* ── Resize handle (bottom-right) ── */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onMouseDown={handleResizeStart}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" className="opacity-15 hover:opacity-30 transition-opacity absolute bottom-[2px] right-[2px]">
          <line x1="12" y1="4" x2="4" y2="12" stroke="white" strokeWidth="1" />
          <line x1="12" y1="8" x2="8" y2="12" stroke="white" strokeWidth="1" />
        </svg>
      </div>
    </motion.div>
  );
});
