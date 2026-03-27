"use client";

import { useDroppable } from "@dnd-kit/core";
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
  clients: Map<string, string>;
  layout: TerminalRegionLayout;
  isBirdEye: boolean;
  onOpenDetail: (opportunity: Opportunity) => void;
  onContextMenu: (e: React.MouseEvent, opportunityId: string) => void;
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
  isBirdEye,
  renderCard,
}: SpatialTerminalRegionProps) {
  const stageColor = OPPORTUNITY_STAGE_COLORS[stage];

  const { setNodeRef, isOver } = useDroppable({
    id: `terminal-${stage}`,
    data: { stage, isTerminal: true },
  });

  const glowOpacity = isOver ? "15" : "05";

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      style={{
        left: layout.bounds.x,
        top: layout.bounds.y,
        width: layout.bounds.width,
        height: layout.bounds.height,
      }}
    >
      {/* Region glow background (dimmer than active stacks) */}
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
      </div>

      {/* Cards in 2D grid */}
      {layout.cardPositions.map((pos) => {
        const opp = opportunities.find((o) => o.id === pos.opportunityId);
        if (!opp) return null;
        return renderCard(opp, pos);
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
          <span className="font-kosugi text-[10px] text-[#333] uppercase">
            {stage === OpportunityStage.Won ? "No won deals" : "No lost deals"}
          </span>
        </div>
      )}
    </div>
  );
}
