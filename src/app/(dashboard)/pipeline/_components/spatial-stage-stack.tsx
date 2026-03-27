"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useDictionary } from "@/i18n/client";
import {
  type Opportunity,
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getStageDisplayName,
  getDaysInStage,
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
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [isRegionHovered, setIsRegionHovered] = useState(false);

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

  // Glow opacity: drag-over > mouse-hover > idle
  const glowOpacity = isOver ? "20" : isRegionHovered ? "15" : "08";

  // Cards displace downward when a foreign card is dragged over this stack
  const displaced = isOver && activeId != null && !oppMap.has(activeId);

  return (
    <div
      ref={setNodeRef}
      className="absolute"
      role="region"
      aria-label={`${getStageDisplayName(stage)} stage - ${opportunities.length} deals`}
      style={{
        left: layout.regionBounds.x,
        top: layout.regionBounds.y,
        width: layout.regionBounds.width,
        height: layout.regionBounds.height,
        background: "rgba(255, 255, 255, 0.015)",
        border: "1px solid rgba(255, 255, 255, 0.04)",
        borderRadius: 8,
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow background */}
      <div
        className="absolute inset-0 pointer-events-none rounded-[4px]"
        style={{
          boxShadow: `inset 0 0 60px ${stageColor}${glowOpacity}`,
          transition: "box-shadow 0.3s ease-out",
        }}
      />

      {/* Header */}
      <div
        className="absolute flex flex-col"
        style={{
          left: 8,
          top: 8,
          width: CARD_WIDTH,
          height: STACK_HEADER_HEIGHT,
          borderBottom: `1px solid ${stageColor}30`,
          padding: "10px 0 0 0",
          background: "rgba(10, 10, 10, 0.25)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
      >
        <div className="flex items-baseline gap-2">
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
        {isHeaderHovered && opportunities.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{ animationDuration: "150ms", animationFillMode: "forwards" }}
          >
            {/* Metric abbreviations — intentionally not i18n'd (universal shorthand) */}
            <span className="font-kosugi text-[10px] text-[#444]">
              avg {Math.round(opportunities.reduce((sum, o) => sum + getDaysInStage(o), 0) / opportunities.length)}d
            </span>
            <span className="font-kosugi text-[10px] text-[#444]">
              oldest: {Math.max(...opportunities.map((o) => getDaysInStage(o)))}d
            </span>
          </div>
        )}
      </div>

      {/* Cards — positions converted from canvas-absolute to stack-relative */}
      {layout.cardPositions.map((pos, index) => {
        const opp = oppMap.get(pos.opportunityId);
        if (!opp) return null;
        // Only displace cards in the bottom half when a foreign card is dragged over
        const shouldDisplace = displaced && index >= Math.floor(layout.cardPositions.length / 2);
        return (
          <div
            key={opp.id}
            style={{
              transition: "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
              transform: shouldDisplace ? "translateY(50px)" : undefined,
            }}
          >
            {renderCard(opp, {
              x: pos.x - layout.regionBounds.x,
              y: pos.y - layout.regionBounds.y,
            })}
          </div>
        );
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
