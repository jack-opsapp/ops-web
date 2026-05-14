"use client";

import { Check, Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

export function ProjectsViewTabs({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  isLoading,
  isError,
}: {
  views: ProjectTableViewDefinition[];
  activeViewId: string | null;
  onViewChange: (viewId: string) => void;
  onCreateView: () => void;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const { t } = useDictionary("projects");
  const statusLabel = isLoading
    ? t("table.views.loading")
    : isError
      ? t("table.views.error")
      : views.length === 0
        ? t("table.views.empty")
        : null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
      {statusLabel ? (
        <div className="shrink-0 px-2 py-1 font-mono text-micro uppercase tracking-wider text-text-3">
          {statusLabel}
        </div>
      ) : (
        views.map((view) => {
          const active = view.id === activeViewId;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onViewChange(view.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-chip border px-2 py-1 font-mono text-micro uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                active
                  ? "border-border bg-surface-active text-text"
                  : "border-border-subtle text-text-3 hover:border-border hover:text-text-2",
              )}
            >
              {active && <Check className="h-3 w-3" />}
              {view.name}
            </button>
          );
        })
      )}
      <button
        type="button"
        onClick={onCreateView}
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-border px-2 py-1 font-cakemono text-[12px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("table.views.newView")}
      </button>
    </div>
  );
}
