"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
  formatCurrency,
} from "@/lib/types/pipeline";
import type { StackLayout } from "./spatial-layout-engine";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  STACK_GAP,
  STACK_HEADER_HEIGHT,
} from "./spatial-canvas-store";

// ── Types ──

interface SpatialStageStackProps {
  stage: OpportunityStage;
  opportunities: Opportunity[];
  layout: StackLayout;
  isBirdEye: boolean;
  activeId: string | null;
  renderCard: (
    opportunity: Opportunity,
    position: { x: number; y: number }
  ) => React.ReactNode;
}

// ── Component ──

export function SpatialStageStack({
  stage,
  opportunities,
  layout,
  isBirdEye,
  activeId,
  renderCard,
}: SpatialStageStackProps) {
  const { t } = useDictionary("pipeline");
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];

  // O(1) lookup instead of O(n) per card
  const oppMap = useMemo(
    () => new Map(opportunities.map((o) => [o.id, o])),
    [opportunities]
  );

  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage}`,
    data: { stage },
  });

  const totalValue = useMemo(
    () =>
      opportunities.reduce(
        (sum, opp) => sum + (opp.estimatedValue ?? 0),
        0
      ),
    [opportunities]
  );

  // Glow opacity based on hover/drop state
  const glowOpacity = isOver ? "20" : "08";

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      style={{
        left: layout.regionBounds.x,
        top: layout.regionBounds.y,
        width: layout.regionBounds.width,
        height: layout.regionBounds.height,
      }}
    >
      {/* Region glow background */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[4px]"
        style={{
          background: `radial-gradient(ellipse at center, ${stageColor}${glowOpacity} 0%, transparent 70%)`,
          transition: "background 0.2s ease-out",
        }}
      />

      {/* Header */}
      <div
        className="absolute flex items-baseline gap-2"
        style={{
          left: 8,
          top: 8,
          width: CARD_WIDTH,
          height: STACK_HEADER_HEIGHT,
          borderTop: `3px solid ${stageColor}`,
          padding: "10px 0 0 0",
        }}
      >
        <span className="font-kosugi text-[10px] text-[#666] uppercase tracking-widest">
          {getStageDisplayName(stage)}
        </span>
        <span className="font-mohave text-sm text-white">
          {opportunities.length}
        </span>
        <span className="font-mohave text-sm text-[#444]">/</span>
        <span className="font-mohave text-sm text-white">
          {totalValue > 0 ? formatCurrency(totalValue) : "$--"}
        </span>
      </div>

      {/* Cards — positions converted from canvas-absolute to stack-relative */}
      {layout.cardPositions.map((pos) => {
        const opp = oppMap.get(pos.opportunityId);
        if (!opp) return null;
        return renderCard(opp, {
          x: pos.x - layout.regionBounds.x,
          y: pos.y - layout.regionBounds.y,
        });
      })}

      {/* Empty state */}
      {opportunities.length === 0 && (
        <div
          className="absolute flex flex-col items-center justify-center border border-dashed border-[rgba(255,255,255,0.1)] rounded-[4px]"
          style={{
            left: 8,
            top: 8 + STACK_HEADER_HEIGHT,
            width: CARD_WIDTH,
            height: CARD_HEIGHT * 2,
          }}
        >
          <span className="font-kosugi text-[10px] text-[#444] uppercase">
            {t("empty.noDeals")}
          </span>
          <span className="font-kosugi text-[9px] text-[#333] uppercase mt-1">
            {t("empty.dropHere")}
          </span>
        </div>
      )}
    </div>
  );
}
