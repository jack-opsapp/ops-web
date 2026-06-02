"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
  type OpportunityStage,
} from "@/lib/types/pipeline";
import { formatCurrency, formatNumber } from "@/lib/utils/pipeline-table-formatters";

/** Fixed height of a stage group-header row, in px. Slightly shorter than a
 *  data row so the header band reads as a divider, not another record. The
 *  table virtualizer keys `estimateSize` off this for header items. */
export const GROUP_HEADER_HEIGHT = 30;

/**
 * Stage group-header row for the pipeline table's grouped view. One header per
 * stage in the flattened render stream (built by `buildFlattenedRows`), sitting
 * inline as a virtualized item — NOT a CSS-sticky element inside the table, so
 * the single virtualizer stays jump-free.
 *
 * Shows a collapse/expand chevron, a stage-color dot (from
 * `OPPORTUNITY_STAGE_COLORS` — never the accent) + the stage label in Cake Mono
 * Light, and right-aligned rollups: count · Σvalue · Σweighted (mono, tabular).
 * The whole band is the toggle — clicking it (or the chevron) collapses /
 * expands the stage via `onToggle`. Rollup numbers reflect the FULL stage even
 * when collapsed (the stream drops the rows, never the totals).
 *
 * Positioned absolutely at `virtualStart` like data rows, spanning `totalWidth`
 * so it tracks horizontal scroll with the grid. Its height is the fixed
 * `GROUP_HEADER_HEIGHT` (density-independent) — no `metrics` needed.
 */
export function PipelineStageGroupHeader({
  stage,
  count,
  sumValue,
  sumWeighted,
  collapsed,
  virtualStart,
  totalWidth,
  onToggle,
}: {
  stage: OpportunityStage;
  count: number;
  sumValue: number;
  sumWeighted: number;
  collapsed: boolean;
  virtualStart: number;
  totalWidth: number;
  onToggle: (stage: OpportunityStage) => void;
}) {
  const { t } = useDictionary("pipeline");
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const stageName = getStageDisplayName(stage);
  const dotColor = OPPORTUNITY_STAGE_COLORS[stage] ?? "#8A8A8A";

  return (
    <button
      type="button"
      role="row"
      aria-expanded={!collapsed}
      aria-label={t("table.group.toggleLabel")
        .replace("{stage}", stageName)
        .replace("{count}", formatNumber(count))}
      onClick={() => onToggle(stage)}
      className={cn(
        "group/header absolute left-0 top-0 flex items-center gap-2 border-b border-border bg-surface-hover-subtle px-[8px] text-left outline-none transition-colors",
        "hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent",
      )}
      style={{
        height: GROUP_HEADER_HEIGHT,
        width: totalWidth,
        transform: `translateY(${virtualStart}px)`,
      }}
    >
      <Chevron
        aria-hidden="true"
        className="h-[13px] w-[13px] shrink-0 text-text-3 transition-colors group-hover/header:text-text-2"
        strokeWidth={1.5}
      />
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      <span className="min-w-0 truncate font-cakemono text-[11px] font-light uppercase tracking-wider text-text">
        {stageName}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-text-3">
        {t("table.group.count").replace("{count}", formatNumber(count))}
      </span>

      {/* Rollups, pinned right. Always show numbers (incl. $0 / 0) — never the
          "—" sentinel, since a present group always has a defined total. */}
      <span className="ml-auto flex shrink-0 items-center gap-3 pr-1 font-mono text-[11px] uppercase tabular-nums tracking-wider">
        <span className="flex items-center gap-1">
          <span className="text-text-mute">{t("table.group.value")}</span>
          <span className="text-text-2">{formatCurrency(sumValue)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-text-mute">{t("table.group.weighted")}</span>
          <span className="text-text-2">{formatCurrency(sumWeighted)}</span>
        </span>
      </span>
    </button>
  );
}
