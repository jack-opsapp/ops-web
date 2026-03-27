"use client";

import { DragOverlay } from "@dnd-kit/core";
import type { Opportunity } from "@/lib/types/pipeline";
import {
  OPPORTUNITY_STAGE_COLORS,
  formatCurrency,
} from "@/lib/types/pipeline";
import { CARD_WIDTH } from "./spatial-canvas-store";
import { DRAG_GRABBED_SHADOW } from "@/lib/utils/motion";

// ── Types ──

interface SpatialDragOverlayProps {
  activeOpportunity: Opportunity | null;
  clientName: string;
  batchCount: number; // total cards being dragged (1 for single, N for batch)
}

// ── Component ──

export function SpatialDragOverlay({
  activeOpportunity,
  clientName,
  batchCount,
}: SpatialDragOverlayProps) {
  if (!activeOpportunity) return null;

  const stageColor =
    OPPORTUNITY_STAGE_COLORS[activeOpportunity.stage] ?? "#BCBCBC";

  return (
    <DragOverlay dropAnimation={null}>
      <div
        className="relative"
        style={{
          width: CARD_WIDTH,
        }}
      >
        {/* Ghost card */}
        <div
          className="w-full rounded-[4px] backdrop-blur-xl"
          style={{
            background: "rgba(13,13,13,0.8)",
            border: "1px solid rgba(255,255,255,0.20)",
            borderLeft: `3px solid ${stageColor}`,
            boxShadow: DRAG_GRABBED_SHADOW,
            transform: "scale(1.03)",
            padding: "8px 10px",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mohave text-sm font-medium text-white truncate">
              {clientName}
            </span>
            <span className="font-mohave text-sm text-[#999] whitespace-nowrap">
              {activeOpportunity.estimatedValue
                ? formatCurrency(activeOpportunity.estimatedValue)
                : "$--"}
            </span>
          </div>
        </div>

        {/* Batch count badge */}
        {batchCount > 1 && (
          <div
            className="absolute -top-2 -right-2 flex items-center justify-center"
            style={{
              background: "rgba(10,10,10,0.8)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
              padding: "2px 8px",
            }}
          >
            <span className="font-kosugi text-[10px] text-white">
              +{batchCount - 1}
            </span>
          </div>
        )}
      </div>
    </DragOverlay>
  );
}
