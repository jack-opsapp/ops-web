"use client";

import { Maximize2, Minimize2, Rows3 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import type { ProjectTableDensity } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";

const DENSITY_OPTIONS = [
  {
    density: "compact",
    labelKey: "table.density.compact",
    icon: Minimize2,
  },
  {
    density: "comfortable",
    labelKey: "table.density.comfortable",
    icon: Rows3,
  },
  {
    density: "spacious",
    labelKey: "table.density.spacious",
    icon: Maximize2,
  },
] as const satisfies readonly {
  density: ProjectTableDensity;
  labelKey: string;
  icon: typeof Rows3;
}[];

export function ProjectsDensityControl({
  density,
  zoom,
  disabled,
  errorKey,
  onDensityChange,
}: {
  density: ProjectTableDensity;
  zoom: number;
  disabled?: boolean;
  errorKey: string | null;
  onDensityChange: (density: ProjectTableDensity) => void;
}) {
  const { t } = useDictionary("projects");

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="group"
        aria-label={t("table.density.label")}
        className="inline-flex rounded-[5px] border border-border bg-surface-input p-0.5"
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
              disabled={disabled}
              onClick={() => onDensityChange(option.density)}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-[5px] px-2 font-cakemono text-[11px] font-light uppercase transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-50",
                active
                  ? "bg-surface-active text-text"
                  : "text-text-3 hover:bg-surface-hover hover:text-text-2",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span aria-hidden="true" className="hidden xl:inline">
                {t(option.labelKey)}
              </span>
            </button>
          );
        })}
      </div>

      <span className="min-w-[44px] text-right font-mono text-micro tabular-nums text-text-2">
        {Math.round(zoom * 100)}%
      </span>

      {errorKey ? (
        <p role="alert" className="max-w-[180px] truncate font-mono text-micro text-rose">
          {t(errorKey)}
        </p>
      ) : null}
    </div>
  );
}
