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
  clients: Map<string, string>;
  layout: StackLayout;
  expandedCardIds: Set<string>;
  selectedCardIds: Set<string>;
  hoveredCardId: string | null;
  isBirdEye: boolean;
  canManage: boolean;
  activeId: string | null;
  // Card callbacks (passed through to children)
  onToggleExpand: (id: string) => void;
  onHoverCard: (id: string | null) => void;
  onSelectCard: (id: string, e: React.MouseEvent) => void;
  onCardContextMenu: (e: React.MouseEvent, id: string) => void;
  onAdvance: (opportunity: Opportunity) => void;
  onRetreat: (opportunity: Opportunity) => void;
  onLogCall: (id: string) => void;
  onLogText: (id: string) => void;
  onAddNote: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onDiscard: (id: string) => void;
  onMarkWon: (opportunity: Opportunity) => void;
  onMarkLost: (opportunity: Opportunity) => void;
  onOpenDetail: (opportunity: Opportunity) => void;
  onAssign: (id: string) => void;
  onScheduleFollowUp: (id: string) => void;
  // Render card function (passed from parent to avoid circular deps)
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

      {/* Cards */}
      {layout.cardPositions.map((pos) => {
        const opp = opportunities.find((o) => o.id === pos.opportunityId);
        if (!opp) return null;
        return renderCard(opp, pos);
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
