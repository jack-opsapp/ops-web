"use client";

import { Check, Plus, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

export function ProjectsViewTabs({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onArchiveView,
  isLoading,
  isError,
}: {
  views: ProjectTableViewDefinition[];
  activeViewId: string | null;
  onViewChange: (viewId: string) => void;
  onCreateView: () => void;
  onArchiveView?: (view: ProjectTableViewDefinition) => void;
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
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {statusLabel ? (
        <div className="shrink-0 px-2 py-1 font-mono text-micro uppercase tracking-wider text-text-3">
          {statusLabel}
        </div>
      ) : (
        views.map((view) => {
          const active = view.id === activeViewId;
          return (
            <div
              key={view.id}
              className={cn(
                "inline-flex h-[28px] shrink-0 items-center rounded-chip border font-mono text-[11px] uppercase tracking-wider transition-colors",
                active
                  ? "border-border bg-surface-active text-text"
                  : "border-border text-text-3 hover:text-text-2",
              )}
            >
              <button
                type="button"
                onClick={() => onViewChange(view.id)}
                className={cn(
                  "inline-flex h-full min-w-0 items-center gap-1 px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  active && "bg-surface-active text-text",
                )}
              >
                {active && <Check className="h-[12px] w-[12px]" strokeWidth={1.5} />}
                <span className="truncate">{view.name}</span>
              </button>
              {!view.isDefault && view.ownerType === "user" && onArchiveView ? (
                <button
                  type="button"
                  aria-label={t("table.views.archiveInline").replace("{name}", view.name)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveView(view);
                  }}
                  className="mr-0.5 flex h-[20px] w-[20px] items-center justify-center rounded text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                >
                  <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={onCreateView}
        className="ml-auto inline-flex h-[28px] shrink-0 items-center gap-1 rounded border border-border px-2 font-cakemono text-[14px] font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      >
        <Plus className="h-[12px] w-[12px]" strokeWidth={1.5} />
        {t("table.views.newView")}
      </button>
    </div>
  );
}
