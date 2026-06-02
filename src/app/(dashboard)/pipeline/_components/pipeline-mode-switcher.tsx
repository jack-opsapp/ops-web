"use client";

import { LayoutGrid, Table } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { usePipelineModeStore } from "./pipeline-mode-store";
import type { PipelineMode } from "./pipeline-mode-types";

const MODE_OPTIONS = [
  {
    mode: "focused",
    labelKey: "mode.focused",
    icon: LayoutGrid,
  },
  {
    mode: "table",
    labelKey: "mode.table",
    icon: Table,
  },
] as const satisfies readonly {
  mode: PipelineMode;
  labelKey: string;
  icon: typeof Table;
}[];

/**
 * Two-segment control switching the pipeline between `focused` and `table`
 * modes. Visual idiom mirrors {@link ProjectsDensityControl} — Cake Mono Light
 * uppercase segments, monochrome surface states, no accent fill (accent is
 * reserved for the focus ring only, per the design system).
 *
 * Reads `mode` and calls `setMode` from {@link usePipelineModeStore}. The page
 * owns the feature-flag gate, so this component renders unconditionally once
 * mounted.
 */
export function PipelineModeSwitcher() {
  const { t } = useDictionary("pipeline");
  const mode = usePipelineModeStore((state) => state.mode);
  const setMode = usePipelineModeStore((state) => state.setMode);

  return (
    <div
      role="group"
      aria-label={t("mode.label")}
      className="inline-flex rounded-[5px] border border-border bg-surface-input p-px"
    >
      {MODE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            aria-label={t(option.labelKey)}
            aria-pressed={active}
            onClick={() => setMode(option.mode)}
            className={cn(
              "inline-flex h-[24px] min-w-[24px] items-center justify-center gap-1 rounded-[5px] px-1.5 font-cakemono text-[10px] font-light uppercase transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
              active
                ? "bg-surface-active text-text"
                : "text-text-3 hover:bg-surface-hover hover:text-text-2",
            )}
          >
            <Icon className="h-[11px] w-[11px]" strokeWidth={1.5} aria-hidden="true" />
            <span aria-hidden="true">{t(option.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
