"use client";

import { useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2, Minimize2, Archive, Trash2, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useSpatialCanvasStore } from "./spatial-canvas-store";
import { usePipelineModeStore } from "./pipeline-mode-store";
import {
  spatialToolbarVariants,
  spatialToolbarVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface SpatialFloatingToolbarProps {
  reviewCount?: number;
  onReviewEmails?: () => void;
}

// ── Component ──

export function SpatialFloatingToolbar({
  reviewCount = 0,
  onReviewEmails,
}: SpatialFloatingToolbarProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialToolbarVariantsReduced
    : spatialToolbarVariants;

  const fitAll = useSpatialCanvasStore((s) => s.fitAll);
  const toggleArchiveTray = useSpatialCanvasStore((s) => s.toggleArchiveTray);
  const isArchiveTrayOpen = useSpatialCanvasStore((s) => s.isArchiveTrayOpen);
  const toggleDiscardTray = useSpatialCanvasStore((s) => s.toggleDiscardTray);
  const isDiscardTrayOpen = useSpatialCanvasStore((s) => s.isDiscardTrayOpen);
  const toggleMode = usePipelineModeStore((s) => s.toggleMode);

  const handleFitAll = useCallback(() => {
    const canvas = document.querySelector("[data-spatial-canvas]");
    if (!canvas) return;
    fitAll(canvas.clientWidth, canvas.clientHeight);
  }, [fitAll]);

  return (
    <motion.div
      className="flex items-center gap-[8px] px-[6px]"
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      {/* Review Emails — only when there are emails to review */}
      {reviewCount > 0 && onReviewEmails && (
        <>
          <ToolbarAction onClick={onReviewEmails}>
            <Mail className="h-[13px] w-[13px]" strokeWidth={1.5} />
            <span className="font-mono text-micro uppercase tracking-wider">
              {t("gmail.reviewEmails")}
            </span>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-chip border border-line-hi bg-surface-active px-1 font-mono text-micro text-text">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </ToolbarAction>
          <div className="h-[18px] w-px bg-border-subtle" />
        </>
      )}

      <ToolbarAction onClick={toggleMode}>
        <Minimize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
          {t("focused.modeButton.focused")}
        </span>
      </ToolbarAction>

      <div className="h-[18px] w-px bg-border-subtle" />

      {/* Canvas tools */}
      <ToolbarAction onClick={handleFitAll}>
        <Maximize2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
          {t("spatial.fitAll")}
        </span>
      </ToolbarAction>

      <div className="h-[18px] w-px bg-border-subtle" />

      <ToolbarAction onClick={toggleArchiveTray} isActive={isArchiveTrayOpen}>
        <Archive className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
          {t("spatial.archivedDeals")}
        </span>
      </ToolbarAction>

      <div className="h-[18px] w-px bg-border-subtle" />

      <ToolbarAction onClick={toggleDiscardTray} isActive={isDiscardTrayOpen}>
        <Trash2 className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
          {t("spatial.discardedDeals")}
        </span>
      </ToolbarAction>
    </motion.div>
  );
}

// ── Sub-components ──

function ToolbarAction({
  children,
  onClick,
  isActive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer items-center gap-[5px] rounded px-[8px] py-[5px] transition-colors duration-150",
        isActive
          ? "border border-line-hi bg-surface-active text-text"
          : "border border-transparent text-text-3 hover:bg-surface-hover hover:text-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
