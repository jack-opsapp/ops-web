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
    position: { x: number; y: number },
    draggable?: boolean,
    flow?: boolean
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
        minHeight: layout.regionBounds.height,
        ...(isBirdEye ? {} : {
          background: "rgba(255, 255, 255, 0.015)",
          border: "1px solid rgba(255, 255, 255, 0.04)",
          borderRadius: 8,
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
            transition: "box-shadow 0.3s ease-out",
          }}
        />
      )}

      {/* Header — hidden in bird's eye */}
      {!isBirdEye && <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 12,
          width: CARD_WIDTH,
          height: STACK_HEADER_HEIGHT,
          padding: "8px 0 0 0",
        }}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onMouseLeave={() => setIsHeaderHovered(false)}
      >
        {/* Bottom border — animates left-to-right on hover */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            height: 1,
            background: isHeaderHovered ? stageColor : `${stageColor}30`,
            width: isHeaderHovered ? "100%" : "100%",
            opacity: isHeaderHovered ? 1 : 0.5,
            transformOrigin: "left",
            transform: isHeaderHovered ? "scaleX(1)" : "scaleX(0.3)",
            transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease-out, background 0.3s ease-out",
          }}
        />
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-micro uppercase tracking-widest"
            style={{
              color: isHeaderHovered ? stageColor : "#666",
              transition: "color 0.25s ease-out",
            }}
          >
            {getStageDisplayName(stage)}
          </span>
          <span className="font-mohave text-body-sm text-text">
            {opportunities.length}
          </span>
          <span className="font-mohave text-body-sm text-text-mute">/</span>
          <span className="font-mohave text-body-sm text-text">
            {totalValue > 0 ? formatCurrency(totalValue) : "$--"}
          </span>
        </div>
        {isHeaderHovered && opportunities.length > 0 && (
          <div
            className="flex items-baseline gap-2 mt-1 opacity-0 animate-fade-in"
            style={{ animationDuration: "150ms", animationFillMode: "forwards" }}
          >
            {/* Metric abbreviations — intentionally not i18n'd (universal shorthand) */}
            <span className="font-mono text-micro text-text-mute">
              avg {Math.round(opportunities.reduce((sum, o) => sum + getDaysInStage(o), 0) / opportunities.length)}d
            </span>
            <span className="font-mono text-micro text-text-mute">
              oldest: {Math.max(...opportunities.map((o) => getDaysInStage(o)))}d
            </span>
          </div>
        )}
      </div>}

      {/* Cards — flex column so expanded cards push siblings down */}
      <div
        className="relative flex flex-col"
        style={{
          marginLeft: 20,
          marginTop: 8,
          paddingBottom: 20,
          width: CARD_WIDTH,
          gap: STACK_GAP,
        }}
      >
        {layout.cardPositions.map((pos) => {
          const opp = oppMap.get(pos.opportunityId);
          if (!opp) return null;
          return renderCard(opp, { x: 0, y: 0 }, true, true);
        })}

        {/* Insertion placeholder when a foreign card is dragged over this stack */}
        {isForeignDragOver && (
          <div
            className="pointer-events-none"
            style={{
              width: CARD_WIDTH,
              height: CARD_HEIGHT,
              border: `1px dashed ${stageColor}30`,
              borderRadius: 4,
              transition: "opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        )}
      </div>

      {/* Empty state */}
      {opportunities.length === 0 && !isBirdEye && (
        <div
          className="absolute flex flex-col items-center justify-center text-center border border-dashed border-[rgba(255,255,255,0.1)] rounded-[4px]"
          style={{
            left: 12,
            top: 20 + STACK_HEADER_HEIGHT,
            right: 12,
            bottom: 12,
          }}
        >
          <span className="font-mono text-micro text-text-mute uppercase">
            {t("empty.noDeals")}
          </span>
          <span className="font-mono text-micro text-text-mute uppercase mt-1">
            {t("empty.dropHere")}
          </span>
        </div>
      )}
    </div>
  );
}
