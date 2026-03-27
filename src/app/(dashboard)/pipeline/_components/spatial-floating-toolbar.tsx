"use client";

import { useCallback, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2, Plus, Archive } from "lucide-react";
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
}

// ── Component ──

export function SpatialFloatingToolbar({
  onAddLead,
}: SpatialFloatingToolbarProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialToolbarVariantsReduced
    : spatialToolbarVariants;

  const fitAll = useSpatialCanvasStore((s) => s.fitAll);
  const toggleArchiveTray = useSpatialCanvasStore((s) => s.toggleArchiveTray);
  const isArchiveTrayOpen = useSpatialCanvasStore((s) => s.isArchiveTrayOpen);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleFitAll = useCallback(() => {
    const canvas = document.querySelector("[data-spatial-canvas]");
    if (!canvas) return;
    fitAll(canvas.clientWidth, canvas.clientHeight);
  }, [fitAll]);

  return (
    <motion.div
      ref={containerRef}
      className="flex items-center"
      style={{
        background: "rgba(10, 10, 10, 0.50)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderRadius: 3,
        padding: "2px 4px",
      }}
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      <ToolbarButton
        icon={<Maximize2 className="w-3 h-3" />}
        tooltip={t("spatial.fitAll")}
        onClick={handleFitAll}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Plus className="w-3 h-3" />}
        tooltip={t("spatial.newLead")}
        onClick={onAddLead}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Archive className="w-3 h-3" />}
        tooltip={t("spatial.archivedDeals")}
        onClick={toggleArchiveTray}
        isActive={isArchiveTrayOpen}
      />
    </motion.div>
  );
}

// ── Sub-components ──

function ToolbarButton({
  icon,
  tooltip,
  onClick,
  isActive,
}: {
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      className={cn(
        "p-[4px] rounded-[2px] transition-all duration-150 cursor-pointer",
        isActive
          ? "text-ops-accent bg-[rgba(89,119,148,0.1)]"
          : "text-text-disabled hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
      )}
      onClick={onClick}
      title={tooltip}
    >
      {icon}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-3 bg-[rgba(255,255,255,0.08)] mx-[2px]" />;
}
