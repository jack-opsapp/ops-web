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
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    fitAll(parent.clientWidth, parent.clientHeight);
  }, [fitAll]);

  return (
    <motion.div
      ref={containerRef}
      className="absolute left-1/2 -translate-x-1/2 flex items-center gap-[2px]"
      style={{
        top: 8,
        zIndex: 100,
        background: "rgba(10, 10, 10, 0.70)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 4,
        padding: "4px 8px",
      }}
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      <ToolbarButton
        icon={<Maximize2 className="w-4 h-4" />}
        tooltip={t("spatial.fitAll")}
        onClick={handleFitAll}
      />
      <ToolbarButton
        icon={<Plus className="w-4 h-4" />}
        tooltip={t("spatial.newLead")}
        onClick={onAddLead}
      />
      <ToolbarButton
        icon={<Archive className="w-4 h-4" />}
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
        "p-[6px] rounded-[2px] transition-all duration-150 cursor-pointer",
        isActive
          ? "text-[#597794] bg-[rgba(89,119,148,0.1)]"
          : "text-[#555] hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
      )}
      onClick={onClick}
      title={tooltip}
    >
      {icon}
    </button>
  );
}
