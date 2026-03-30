"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Toggle columns">
                      <Columns3 className="h-[13px] w-[13px] text-text-tertiary" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {toggleableColumns.map((tc) => (
                      <DropdownMenuCheckboxItem
                        key={tc.id}
                        checked={columnVisibility[tc.id] !== false}
                        onCheckedChange={(checked) => {
                          onColumnVisibilityChange({
                            ...columnVisibility,
                            [tc.id]: !!checked,
                          });
                        }}
                      >
                        {t(`spreadsheet.columns.${tc.header}`)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
