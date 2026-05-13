"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableColumnConfig, ProjectTableSort } from "@/lib/types/project-table";
import type { ProjectTableColumnLayout, ProjectsTableMetrics } from "./projects-table";

export function ProjectsTableHeader({
  columns,
  metrics,
  sorting,
  onSortChange,
}: {
  columns: ProjectTableColumnLayout[];
  metrics: ProjectsTableMetrics;
  sorting: ProjectTableSort[];
  onSortChange: (column: ProjectTableColumnConfig) => void;
}) {
  const { t } = useDictionary("projects");
  const activeSort = sorting[0];

  return (
    <div className="sticky top-0 z-20 flex border-b border-border bg-background" style={{ height: metrics.headerHeight }}>
      {columns.map(({ column, width, stickyLeft }) => {
        const sorted = activeSort && String(activeSort.field) === column.id ? activeSort.direction : null;

        return (
          <div
            key={column.id}
            className={cn(
              "flex shrink-0 items-center border-r border-border-subtle bg-background px-2",
              column.align === "right" && "justify-end",
              stickyLeft != null && "sticky z-30",
            )}
            style={{
              width,
              minWidth: width,
              maxWidth: width,
              left: stickyLeft ?? undefined,
              fontSize: metrics.microFontSize,
            }}
          >
            {column.id === "select" ? (
              <span className="h-3.5 w-3.5 rounded-[3px] border border-border-subtle" />
            ) : (
              <button
                type="button"
                disabled={!column.sortable}
                onClick={() => onSortChange(column)}
                className={cn(
                  "flex min-w-0 items-center gap-1 font-mono uppercase tracking-wider text-text-3",
                  column.sortable && "hover:text-text-2",
                  sorted && "text-text",
                )}
              >
                <span className="truncate">{t(column.labelKey)}</span>
                {sorted === "asc" && <ArrowUp className="h-3 w-3 shrink-0" />}
                {sorted === "desc" && <ArrowDown className="h-3 w-3 shrink-0" />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
