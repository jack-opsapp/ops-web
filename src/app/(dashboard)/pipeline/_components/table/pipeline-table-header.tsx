"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import type {
  PipelineTableColumnConfig,
  PipelineTableSort,
} from "@/lib/types/pipeline-table";
import type { PipelineTableColumnLayout, PipelineTableMetrics } from "./pipeline-table";

/**
 * Sticky pipeline-table header. Mirrors the projects table header: frozen
 * columns stick to the left rail, sortable columns toggle asc → desc → none via
 * chevrons, the select column hosts a "select all visible" checkbox. Labels are
 * mono/uppercase/tracked in the tertiary text tone — never the accent.
 */
export function PipelineTableHeader({
  columns,
  metrics,
  sorting,
  canManage,
  onSortChange,
  allVisibleSelected,
  onToggleSelectAllVisible,
}: {
  columns: PipelineTableColumnLayout[];
  metrics: PipelineTableMetrics;
  sorting: PipelineTableSort[];
  /**
   * Whether the operator can manage the pipeline. Gates the select-all checkbox:
   * selection only feeds bulk mutations a view-only operator can't perform, so
   * without manage the select column renders empty (in lockstep with the rows,
   * which also drop their per-row checkbox). Sorting stays available regardless.
   */
  canManage: boolean;
  onSortChange: (column: PipelineTableColumnConfig) => void;
  allVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
}) {
  const { t } = useDictionary("pipeline");
  const activeSort = sorting[0];

  return (
    <div className="sticky top-0 z-20 flex border-b border-border bg-background" style={{ height: metrics.headerHeight }}>
      {columns.map(({ column, width, stickyLeft }) => {
        const sorted = activeSort && activeSort.field === column.id ? activeSort.direction : null;

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
              canManage ? (
                <Checkbox
                  aria-label={t("table.column.select")}
                  checked={allVisibleSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleSelectAllVisible();
                  }}
                  className="rounded-chip"
                />
              ) : null
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
