"use client";

import { Maximize2, Minimize2, Rows3 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
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
  onZoomChange,
}: {
  density: ProjectTableDensity;
  zoom: number;
  disabled?: boolean;
  errorKey: string | null;
  onDensityChange: (density: ProjectTableDensity) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const { t } = useDictionary("projects");
  const [draftZoom, setDraftZoom] = useState(String(Math.round(zoom * 100)));

  useEffect(() => {
    setDraftZoom(String(Math.round(zoom * 100)));
  }, [zoom]);

  const commitDraftZoom = () => {
    const numericValue = Number(draftZoom.replace("%", "").trim());
    if (!Number.isFinite(numericValue)) {
      setDraftZoom(String(Math.round(zoom * 100)));
      return;
    }
    const percent = Math.min(150, Math.max(75, Math.round(numericValue)));
    setDraftZoom(String(percent));
    onZoomChange(percent / 100);
  };

  const handleZoomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraftZoom();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftZoom(String(Math.round(zoom * 100)));
      event.currentTarget.blur();
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="group"
        aria-label={t("table.density.label")}
        className="inline-flex rounded-[5px] border border-border bg-surface-input p-px"
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
                "inline-flex h-[24px] min-w-[24px] items-center justify-center gap-1 rounded-[5px] px-1.5 font-cakemono text-[11px] font-light uppercase transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-50",
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

      <label className="flex h-[26px] w-[58px] items-center rounded-[5px] border border-border bg-surface-input px-1.5 focus-within:ring-1 focus-within:ring-ops-accent">
        <span className="sr-only">{t("table.density.zoom")}</span>
        <input
          aria-label={t("table.density.zoom")}
          value={draftZoom}
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={disabled}
          onChange={(event) => {
            const nextValue = event.target.value.replace(/[^\d]/g, "").slice(0, 3);
            setDraftZoom(nextValue);
          }}
          onBlur={commitDraftZoom}
          onKeyDown={handleZoomKeyDown}
          className="min-w-0 flex-1 bg-transparent text-right font-mono text-micro tabular-nums text-text-2 outline-none disabled:opacity-50"
        />
        <span aria-hidden="true" className="font-mono text-micro text-text-3">
          %
        </span>
      </label>

      {errorKey ? (
        <p role="alert" className="max-w-[180px] truncate font-mono text-micro text-rose">
          {t(errorKey)}
        </p>
      ) : null}
    </div>
  );
}
