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

  // True when a card from another stack is being dragged over this one
  const isForeignDragOver = isOver && activeId != null && !oppMap.has(activeId);

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
          <span className="font-kosugi text-micro-sm text-text-tertiary uppercase tracking-widest">
            {getStageDisplayName(stage)}
          </span>
          <span className="font-mohave text-body-sm text-text-primary">
            {opportunities.length}
          </span>
          <span className="font-mohave text-body-sm text-text-disabled">/</span>
          <span className="font-mohave text-body-sm text-text-primary">
            {totalValue > 0 ? formatCurrency(totalValue) : "$--"}
          </span>
        </div>
        {isHeaderHovered && opportunities.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{ animationDuration: "150ms", animationFillMode: "forwards" }}
          >
            {/* Metric abbreviations — intentionally not i18n'd (universal shorthand) */}
            <span className="font-kosugi text-micro-sm text-text-disabled">
              avg {Math.round(opportunities.reduce((sum, o) => sum + getDaysInStage(o), 0) / opportunities.length)}d
            </span>
            <span className="font-kosugi text-micro-sm text-text-disabled">
              oldest: {Math.max(...opportunities.map((o) => getDaysInStage(o)))}d
            </span>
          </div>
        )}
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

      {/* Insertion placeholder when a foreign card is dragged over this stack */}
      {isForeignDragOver && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: 8,
            top:
              layout.cardPositions.length > 0
                ? layout.cardPositions[layout.cardPositions.length - 1].y -
                  layout.regionBounds.y +
                  CARD_HEIGHT +
                  STACK_GAP
                : 8 + STACK_HEADER_HEIGHT,
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            border: `1px dashed ${stageColor}30`,
            borderRadius: 4,
            opacity: 1,
            transition: "opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      )}

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
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase">
            {t("empty.noDeals")}
          </span>
          <span className="font-kosugi text-micro-xs text-text-disabled uppercase mt-1">
            {t("empty.dropHere")}
          </span>
        </div>
      )}
    </div>
  );
}
