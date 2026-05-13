"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableViewDefinition } from "@/lib/types/project-table";

export function ProjectsViewTabs({
  views,
  activeViewId,
  onViewChange,
}: {
  views: ProjectTableViewDefinition[];
  activeViewId: string | null;
  onViewChange: (viewId: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-2">
      {views.map((view) => {
        const active = view.id === activeViewId;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onViewChange(view.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-chip border px-2 py-1 font-mono text-micro uppercase tracking-wider transition-colors",
              active
                ? "border-border bg-surface-active text-text"
                : "border-border-subtle text-text-3 hover:border-border hover:text-text-2",
            )}
          >
            {active && <Check className="h-3 w-3" />}
            {view.name}
          </button>
        );
      })}
    </div>
  );
}
