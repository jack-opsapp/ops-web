"use client";

import { useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2, Plus, Archive, Trash2, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useSpatialCanvasStore } from "./spatial-canvas-store";
import {
  spatialToolbarVariants,
  spatialToolbarVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface SpatialFloatingToolbarProps {
  onAddLead: () => void;
  reviewCount?: number;
  onReviewEmails?: () => void;
}

// ── Component ──

export function SpatialFloatingToolbar({
  onAddLead,
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
            <Mail className="w-[13px] h-[13px] text-ops-accent" />
            <span className="font-kosugi text-micro-sm text-ops-accent uppercase tracking-wider">
              {t("gmail.reviewEmails")}
            </span>
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-sm border border-ops-accent/30 bg-ops-accent-muted font-kosugi text-micro-xs text-ops-accent">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </ToolbarAction>
          <div className="w-[1px] h-[18px] bg-border-subtle" />
        </>
      )}

      {/* Canvas tools */}
      <ToolbarAction onClick={handleFitAll}>
        <Maximize2 className="w-[13px] h-[13px]" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
          {t("spatial.fitAll")}
        </span>
      </ToolbarAction>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      <ToolbarAction onClick={onAddLead}>
        <Plus className="w-[13px] h-[13px]" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
          {t("spatial.newLead")}
        </span>
      </ToolbarAction>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      <ToolbarAction onClick={toggleArchiveTray} isActive={isArchiveTrayOpen}>
        <Archive className="w-[13px] h-[13px]" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
          {t("spatial.archivedDeals")}
        </span>
      </ToolbarAction>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      <ToolbarAction onClick={toggleDiscardTray} isActive={isDiscardTrayOpen}>
        <Trash2 className="w-[13px] h-[13px]" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
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
      className={cn(
        "flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-ops-accent bg-ops-accent-muted/20"
          : "text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
