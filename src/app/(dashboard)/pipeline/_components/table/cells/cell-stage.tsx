import {
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
  type OpportunityStage,
} from "@/lib/types/pipeline";

/**
 * Stage chip. A left dot tinted with the stage's own color (NEVER the steel-blue
 * accent — that is reserved for focus rings / primary CTAs) plus the stage's
 * human label. The chip body stays neutral; only the dot carries the stage hue,
 * keeping the rail calm while still color-coding the stage at a glance.
 */
export function CellStage({ stage }: { stage: OpportunityStage }) {
  const color = OPPORTUNITY_STAGE_COLORS[stage] ?? "var(--text-3)";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-chip font-mono text-micro uppercase tracking-[0.16em] text-text-2">
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="truncate">{getStageDisplayName(stage)}</span>
    </span>
  );
}
