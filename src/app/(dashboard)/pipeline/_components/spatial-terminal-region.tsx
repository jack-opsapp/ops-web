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
import type { TerminalRegionLayout } from "./spatial-layout-engine";
import { CARD_WIDTH, STACK_HEADER_HEIGHT } from "./spatial-canvas-store";

// ── Types ──

interface SpatialTerminalRegionProps {
  stage: OpportunityStage.Won | OpportunityStage.Lost;
  opportunities: Opportunity[];
  layout: TerminalRegionLayout;
  isBirdEye?: boolean;
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
  isBirdEye = false,
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

  const totalValue = useMemo(
    () =>
      opportunities.reduce(
        (sum, opp) => sum + (opp.estimatedValue ?? 0),
        0
      ),
    [opportunities]
  );

  // Hex alpha tiers: drag-over > mouse-hover > idle
  const bgAlpha = isOver ? "14" : isRegionHovered ? "0C" : "06";
  const borderAlpha = isOver ? "30" : isRegionHovered ? "20" : "10";
  const glowOpacity = isOver ? "28" : isRegionHovered ? "18" : "08";

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
        ...(isBirdEye ? {} : {
          background: `${stageColor}${bgAlpha}`,
          borderRadius: 4,
          border: `1px solid ${stageColor}${borderAlpha}`,
          transition: "background 0.2s ease-out, border-color 0.2s ease-out",
        }),
      }}
      onMouseEnter={() => setIsRegionHovered(true)}
      onMouseLeave={() => setIsRegionHovered(false)}
    >
      {/* Region glow — hidden in bird's eye */}
      {!isBirdEye && (
        <div
          className="absolute inset-0 pointer-events-none rounded-[4px]"
          style={{
            boxShadow: `inset 0 0 60px ${stageColor}${glowOpacity}`,
            transition: "box-shadow 0.2s ease-out",
          }}
        />
      )}

      {/* Header — hidden in bird's eye */}
      {!isBirdEye && <div
        className="absolute flex flex-col"
        style={{
          left: 20,
          top: 12,
          width: CARD_WIDTH,
          height: STACK_HEADER_HEIGHT,
          padding: "8px 0 0 0",
          position: "relative",
        }}
      >
        {/* Bottom border — animates left-to-right on hover */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 1,
            background: isRegionHovered ? stageColor : `${stageColor}30`,
            width: "100%",
            opacity: isRegionHovered ? 1 : 0.5,
            transformOrigin: "left",
            transform: isRegionHovered ? "scaleX(1)" : "scaleX(0.3)",
            transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease-out, background 0.3s ease-out",
          }}
        />
        <div className="flex items-baseline gap-2">
          <span
            className="font-kosugi text-micro-sm uppercase tracking-widest"
            style={{
              color: isRegionHovered ? stageColor : "#666",
              transition: "color 0.25s ease-out",
            }}
          >
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
        {isRegionHovered && opportunities.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{ animationDuration: "150ms", animationFillMode: "forwards" }}
          >
            <span className="font-kosugi text-micro-sm text-text-disabled">
              avg {Math.round(opportunities.reduce((sum, o) => sum + getDaysInStage(o), 0) / opportunities.length)}d
            </span>
            <span className="font-kosugi text-micro-sm text-text-disabled">
              oldest: {Math.max(...opportunities.map((o) => getDaysInStage(o)))}d
            </span>
          </div>
        )}
      </div>}

      {/* Cards in 2D grid — positions converted from canvas-absolute to region-relative */}
      {layout.cardPositions.map((pos) => {
        const opp = oppMap.get(pos.opportunityId);
        if (!opp) return null;
        return renderCard(opp, {
          x: pos.x - layout.bounds.x,
          y: pos.y - layout.bounds.y,
        });
      })}

      {/* Empty state — hidden in bird's eye */}
      {opportunities.length === 0 && !isBirdEye && (
        <div
          className="absolute flex items-center justify-center border border-dashed border-[rgba(255,255,255,0.06)] rounded-[4px]"
          style={{
            left: 20,
            top: 12 + STACK_HEADER_HEIGHT,
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
