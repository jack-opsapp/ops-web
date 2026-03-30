"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import {
  SPREADSHEET_COLUMNS,
  type SpreadsheetSortDirection,
} from "./spreadsheet-columns";

interface SpreadsheetHeaderProps {
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (vis: Record<string, boolean>) => void;
  sortColumn: string | null;
  sortDirection: SpreadsheetSortDirection;
  onSort: (columnId: string) => void;
  canViewAccounting: boolean;
}

export function SpreadsheetHeader({
  columnVisibility,
  onColumnVisibilityChange,
  sortColumn,
  sortDirection,
  onSort,
  canViewAccounting,
}: SpreadsheetHeaderProps) {
  const { t } = useDictionary("projects-canvas");
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showColumnMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColumnMenu]);

  const visibleColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.permission && !canViewAccounting) return false;
    return columnVisibility[col.id] !== false;
  });

  const toggleableColumns = SPREADSHEET_COLUMNS.filter((col) => {
    if (col.id === "actions") return false;
    if (col.permission && !canViewAccounting) return false;
    return true;
  });

  return (
    <thead>
      <tr className="border-b border-border-medium bg-background-panel sticky top-0 z-10">
        {visibleColumns.map((col) => {
          if (col.id === "actions") {
            return (
              <th key={col.id} className="w-[40px] px-1 py-1.5">
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowColumnMenu(!showColumnMenu); }}
                    className="flex items-center justify-center h-6 w-6 rounded-sm text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                    aria-label="Toggle columns"
                  >
                    <Columns3 className="h-[13px] w-[13px]" />
                  </button>

                  {showColumnMenu && (
                    <div
                      className="absolute top-full left-0 mt-1 z-[1000] min-w-[180px] max-h-[320px] overflow-y-auto p-1 rounded-[4px]"
                      style={{
                        background: "rgba(10,10,10,0.95)",
                        backdropFilter: "blur(20px) saturate(1.2)",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      {toggleableColumns.map((tc) => {
                        const isChecked = columnVisibility[tc.id] !== false;
                        return (
                          <button
                            key={tc.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onColumnVisibilityChange({
                                ...columnVisibility,
                                [tc.id]: !isChecked,
                              });
                            }}
                            className={cn(
                              "flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] transition-colors",
                              isChecked
                                ? "text-text-primary"
                                : "text-text-disabled"
                            )}
                          >
                            <span className={cn(
                              "w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
                              isChecked
                                ? "border-ops-accent bg-ops-accent-muted/30"
                                : "border-border-subtle"
                            )}>
                              {isChecked && <span className="text-[9px] text-ops-accent">✓</span>}
                            </span>
                            <span className="font-mohave text-body-sm">
                              {t(`spreadsheet.columns.${tc.header}`)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </th>
            );
          }

          const isSorted = sortColumn === col.id;

          return (
            <th
              key={col.id}
              className={cn(
                "px-1.5 py-1.5 text-left whitespace-nowrap",
                "font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest",
                col.sortable && "cursor-pointer select-none hover:text-text-secondary transition-colors"
              )}
              style={{ width: col.width, minWidth: col.id === "title" ? col.width : undefined }}
              onClick={col.sortable ? () => onSort(col.id) : undefined}
            >
              <span className="inline-flex items-center gap-0.5">
                {t(`spreadsheet.columns.${col.header}`)}
                {col.sortable && (
                  <span className="text-text-disabled">
                    {isSorted && sortDirection === "asc" ? (
                      <ArrowUp className="h-[13px] w-[13px] text-ops-accent" />
                    ) : isSorted && sortDirection === "desc" ? (
                      <ArrowDown className="h-[13px] w-[13px] text-ops-accent" />
                    ) : (
                      <ArrowUpDown className="h-[13px] w-[13px]" />
                    )}
                  </span>
                )}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
