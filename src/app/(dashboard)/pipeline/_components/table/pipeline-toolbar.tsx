"use client";

import { CheckCircle, Layers, Maximize2, Minimize2, Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableDensity } from "@/lib/types/project-table";

const DENSITY_OPTIONS = [
  { density: "compact", labelKey: "table.density.compact", icon: Minimize2 },
  { density: "comfortable", labelKey: "table.density.comfortable", icon: Rows3 },
  { density: "spacious", labelKey: "table.density.spacious", icon: Maximize2 },
] as const satisfies readonly {
  density: ProjectTableDensity;
  labelKey: string;
  icon: typeof Rows3;
}[];

/**
 * Pipeline-table toolbar cluster: a grouping toggle, a closed-deals toggle, a
 * `// N deals` readout, a minimal 3-segment density control, plus optional slots
 * for the saved-view Save affordance and the view-settings menu. This is the
 * TABLE mode's mode-specific control cluster — the mode switcher and the shared
 * search field live once in the persistent toolbar owned by `pipeline/page.tsx`
 * (WEB OVERHAUL P6-2 rework), so they are NOT rendered here; this cluster is
 * portaled into that toolbar's right-hand control group (which owns the
 * right-alignment), ahead of the shared review + NEW LEAD actions.
 * Styled like the projects density-control idiom (Cake Mono Light segments,
 * surface-input rail). Active toggles use `bg-surface-active` (never the accent —
 * accent is reserved for focus rings + the single primary CTA, which here is the
 * Save button passed in via `saveAffordance`).
 */
export function PipelineToolbar({
  dealCount,
  grouped,
  onGroupedChange,
  closedDeals,
  onClosedDealsChange,
  density,
  onDensityChange,
  densityDisabled,
  saveAffordance,
  viewSettings,
}: {
  dealCount: number;
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  closedDeals: boolean;
  onClosedDealsChange: (closedDeals: boolean) => void;
  density: ProjectTableDensity;
  onDensityChange: (density: ProjectTableDensity) => void;
  densityDisabled?: boolean;
  saveAffordance?: ReactNode;
  viewSettings?: ReactNode;
}) {
  const { t } = useDictionary("pipeline");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label={t("table.toolbar.group")}
          aria-pressed={grouped}
          onClick={() => onGroupedChange(!grouped)}
          className={cn(
            "inline-flex h-[28px] items-center gap-1.5 rounded border px-2 font-mono text-micro font-medium uppercase tracking-[0.12em] transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
            grouped
              ? "border-border bg-surface-active text-text"
              : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
          )}
        >
          <Layers className="h-[12px] w-[12px]" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden lg:inline">{t("table.toolbar.group")}</span>
        </button>
        <button
          type="button"
          aria-label={t("table.toolbar.closed")}
          aria-pressed={closedDeals}
          onClick={() => onClosedDealsChange(!closedDeals)}
          className={cn(
            "inline-flex h-[28px] items-center gap-1.5 rounded border px-2 font-mono text-micro font-medium uppercase tracking-[0.12em] transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
            closedDeals
              ? "border-border bg-surface-active text-text"
              : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
          )}
        >
          <CheckCircle className="h-[12px] w-[12px]" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden lg:inline">{t("table.toolbar.closed")}</span>
        </button>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          {t("table.toolbar.deals").replace("{count}", String(dealCount))}
        </span>
        {saveAffordance}
        <div
          role="group"
          aria-label={t("table.density.label")}
          className="inline-flex rounded border border-border bg-surface-input p-px"
        >
          {DENSITY_OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = option.density === density;
            return (
              <button
                key={option.density}
                type="button"
                aria-label={t(option.labelKey)}
                aria-pressed={active}
                disabled={densityDisabled}
                onClick={() => onDensityChange(option.density)}
                className={cn(
                  "inline-flex h-[24px] min-w-[24px] items-center justify-center gap-1 rounded px-1.5 font-mono text-micro font-medium uppercase tracking-[0.12em] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  "disabled:pointer-events-none disabled:opacity-40",
                  active
                    ? "bg-surface-active text-text"
                    : "text-text-3 hover:bg-surface-hover hover:text-text-2",
                )}
              >
                <Icon className="h-[11px] w-[11px]" strokeWidth={1.5} aria-hidden="true" />
                <span aria-hidden="true" className="hidden xl:inline">
                  {t(option.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
        {viewSettings}
    </div>
  );
}
