"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import type { TerminalRegionLayout } from "./spatial-layout-engine";
import { CARD_WIDTH, STACK_HEADER_HEIGHT } from "./spatial-canvas-store";

// ── Types ──

interface SpatialTerminalRegionProps {
  stage: OpportunityStage.Won | OpportunityStage.Lost;
  opportunities: Opportunity[];
  layout: TerminalRegionLayout;
  renderCard: (
    opportunity: Opportunity,
    position: { x: number; y: number }
  ) => React.ReactNode;
}

// ── Component ──

export function SpatialTerminalRegion({
  stage,
  opportunities,
  layout,
  renderCard,
}: SpatialTerminalRegionProps) {
  const { t } = useDictionary("pipeline");
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
  const [isRegionHovered, setIsRegionHovered] = useState(false);

  // O(1) lookup instead of O(n) per card
  const oppMap = useMemo(
    () => new Map(opportunities.map((o) => [o.id, o])),
    [opportunities]
  );

  const { setNodeRef, isOver } = useDroppable({
    id: `terminal-${stage}`,
    data: { stage, isTerminal: true },
  });

  // Glow opacity: drag-over > mouse-hover > idle
  const glowOpacity = isOver ? "15" : isRegionHovered ? "10" : "05";

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      role="region"
      aria-label={`${getStageDisplayName(stage)} stage - ${opportunities.length} deals`}
      style={{
        left: layout.bounds.x,
        top: layout.bounds.y,
        width: layout.bounds.width,
        height: layout.bounds.height,
        background: `${stageColor}05`,
        borderRadius: 4,
        border: `1px solid ${stageColor}10`,
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow background (dimmer than active stacks) */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[4px]"
        style={{
          boxShadow: `inset 0 0 60px ${stageColor}${glowOpacity}`,
          transition: "box-shadow 0.2s ease-out",
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
          borderBottom: `1px solid ${stageColor}30`,
          padding: "10px 0 0 0",
        }}
      >
        <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest">
          {getStageDisplayName(stage)}
        </span>
        <span className="font-mohave text-body-sm text-text-primary">
          {opportunities.length}
        </span>
      </div>

      {/* Cards in 2D grid — positions converted from canvas-absolute to region-relative */}
      {layout.cardPositions.map((pos) => {
        const opp = oppMap.get(pos.opportunityId);
        if (!opp) return null;
        return renderCard(opp, {
          x: pos.x - layout.bounds.x,
          y: pos.y - layout.bounds.y,
        });
      })}

      {/* Empty state */}
      {opportunities.length === 0 && (
        <div
          className="absolute flex items-center justify-center border border-dashed border-[rgba(255,255,255,0.06)] rounded-[4px]"
          style={{
            left: 8,
            top: 8 + STACK_HEADER_HEIGHT,
            width: CARD_WIDTH,
            height: 44,
          }}
        >
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {stage === OpportunityStage.Won ? t("spatial.noWonDeals") : t("spatial.noLostDeals")}
          </span>
        </div>
      )}
    </div>
  );
}
