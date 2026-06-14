"use client";

import { useEffect, useRef } from "react";
import {
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  isTerminalStage,
} from "@/lib/types/pipeline";

interface PipelineStageTabBarProps {
  stages: OpportunityStage[];
  counts: Record<OpportunityStage, number>;
  activeStage: OpportunityStage;
  onStageChange: (stage: OpportunityStage) => void;
}

const STAGE_ABBREVIATIONS: Record<OpportunityStage, string> = {
  [OpportunityStage.NewLead]: "NEW",
  [OpportunityStage.Qualifying]: "QUAL",
  [OpportunityStage.Quoting]: "QUOT",
  [OpportunityStage.Quoted]: "QTD",
  [OpportunityStage.FollowUp]: "FU",
  [OpportunityStage.Negotiation]: "NEG",
  [OpportunityStage.Won]: "WON",
  [OpportunityStage.Lost]: "LOST",
  [OpportunityStage.Discarded]: "DISC",
};

export function PipelineStageTabBar({
  stages,
  counts,
  activeStage,
  onStageChange,
}: PipelineStageTabBarProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
      });
    }
  }, [activeStage]);

  // Track whether we've already inserted the terminal divider
  let terminalDividerInserted = false;

  return (
    <div className="flex overflow-x-auto scrollbar-hide gap-0">
      {stages.map((stage) => {
        const isActive = stage === activeStage;
        const isTerminal = isTerminalStage(stage);
        const stageColor = OPPORTUNITY_STAGE_COLORS[stage];
        const count = counts[stage] ?? 0;
        const abbreviation = STAGE_ABBREVIATIONS[stage];

        // Insert divider before the first terminal stage
        const shouldInsertDivider = isTerminal && !terminalDividerInserted;
        if (shouldInsertDivider) {
          terminalDividerInserted = true;
        }

        return (
          <div key={stage} className="flex items-center shrink-0">
            {shouldInsertDivider && (
              <div className="w-px h-[24px] bg-fill-neutral-dim self-center mx-[4px] shrink-0" />
            )}

            <button
              ref={isActive ? activeTabRef : null}
              onClick={() => onStageChange(stage)}
              className={[
                "flex flex-col items-center px-[10px] py-[6px] cursor-pointer",
                "transition-colors duration-150 relative shrink-0",
                isActive ? "text-text" : "text-text-mute",
              ].join(" ")}
              aria-selected={isActive}
              role="tab"
              type="button"
            >
              <span className="font-mono text-micro uppercase tracking-[0.16em]">
                {abbreviation}
              </span>
              <span className="font-mono text-body-sm tabular-nums">{count}</span>

              {isActive && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: stageColor }}
                />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
