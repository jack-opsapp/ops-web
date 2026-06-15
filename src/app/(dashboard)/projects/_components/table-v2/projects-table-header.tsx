"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import type { ProjectTableColumnConfig, ProjectTableSort } from "@/lib/types/project-table";
import type { ProjectTableColumnLayout, ProjectsTableMetrics } from "./projects-table";

export function ProjectsTableHeader({
  columns,
  metrics,
  sorting,
  onSortChange,
  allVisibleSelected,
  onToggleSelectAllVisible,
}: {
  columns: ProjectTableColumnLayout[];
  metrics: ProjectsTableMetrics;
  sorting: ProjectTableSort[];
  onSortChange: (column: ProjectTableColumnConfig) => void;
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
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
              "flex shrink-0 items-center border-r border-border bg-background px-[8px]",
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
              <Checkbox
                aria-label={t("table.column.select")}
                checked={allVisibleSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelectAllVisible();
                }}
                className="rounded-[3px]"
              />
            ) : (
              <button
                type="button"
                disabled={!column.sortable}
                onClick={() => onSortChange(column)}
                className={cn(
                  "flex min-w-0 items-center gap-1 font-mono uppercase tracking-[0.16em] text-text-3",
                  column.sortable && "hover:text-text-2",
                  sorted && "text-text",
                )}
              >
                <span className="truncate">{t(column.labelKey)}</span>
                {sorted === "asc" && (
                  <ChevronUp className="h-[12px] w-[12px] shrink-0" strokeWidth={1.5} />
                )}
                {sorted === "desc" && (
                  <ChevronDown className="h-[12px] w-[12px] shrink-0" strokeWidth={1.5} />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
