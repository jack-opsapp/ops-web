"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────

export type SortDirection = "asc" | "desc" | null;

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  accessorFn?: (row: T) => React.ReactNode;
  sortable?: boolean;
  visible?: boolean;
  mono?: boolean;
  width?: string;
  cell?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyField: keyof T;
  loading?: boolean;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  bulkActions?: React.ReactNode;
  sortColumn?: string | null;
  sortDirection?: SortDirection;
  onSort?: (columnId: string, direction: SortDirection) => void;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}

// ─── Skeleton Row ────────────────────────────────────────────────────

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr className="border-b border-border-subtle">
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-1.5 py-1.5">
          <div className="h-[16px] w-full max-w-[120px] rounded-sm bg-background-elevated animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

// ─── Component ───────────────────────────────────────────────────────

function DataTableInner<T>(
  {
    columns,
    data,
    keyField,
    loading = false,
    emptyMessage = "No data found",
    emptyIcon,
    selectable = false,
    selectedKeys = new Set(),
    onSelectionChange,
    bulkActions,
    sortColumn = null,
    sortDirection = null,
    onSort,
    page = 1,
    pageSize = 25,
    totalCount,
    onPageChange,
    className,
  }: DataTableProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>(() => {
    const vis: Record<string, boolean> = {};
    columns.forEach((col) => {
      vis[col.id] = col.visible !== false;
    });
    return vis;
  });

  const visibleColumns = columns.filter((col) => columnVisibility[col.id] !== false);
  const totalCols = visibleColumns.length + (selectable ? 1 : 0);

  const total = totalCount ?? data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const allSelected = data.length > 0 && data.every((row) => selectedKeys.has(String(row[keyField])));
  const someSelected = data.some((row) => selectedKeys.has(String(row[keyField]))) && !allSelected;

  function handleSelectAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      const newKeys = new Set(data.map((row) => String(row[keyField])));
      onSelectionChange(newKeys);
    }
  }

  function handleSelectRow(key: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onSelectionChange(next);
  }

  function handleSort(columnId: string) {
    if (!onSort) return;
    let next: SortDirection;
    if (sortColumn !== columnId) {
      next = "asc";
    } else if (sortDirection === "asc") {
      next = "desc";
    } else {
      next = null;
    }
    onSort(columnId, next);
  }

  function getCellValue(row: T, col: ColumnDef<T>): React.ReactNode {
    if (col.cell) return col.cell(row);
    if (col.accessorFn) return col.accessorFn(row);
    if (col.accessorKey) return String(row[col.accessorKey] ?? "");
    return "";
  }

  return (
    <div ref={ref} className={cn("flex flex-col gap-1", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-1">
        {/* Bulk actions */}
        {selectable && selectedKeys.size > 0 && (
          <div className="flex items-center gap-1 animate-fade-in">
            <span className="text-caption-sm text-ops-accent font-mono">
              {selectedKeys.size} selected
            </span>
            {bulkActions}
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Column visibility */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Toggle columns">
                <Columns3 className="h-[16px] w-[16px]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={columnVisibility[col.id] !== false}
                  onCheckedChange={(checked) =>
                    setColumnVisibility((prev) => ({ ...prev, [col.id]: !!checked }))
                  }
                >
                  {col.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-medium bg-background-panel">
              {selectable && (
                <th className="w-[40px] px-1 py-1">
                  <Checkbox
                    checked={allSelected}
                    ref={(el) => {
                      if (el) {
                        (el as unknown as HTMLInputElement).indeterminate = someSelected;
                      }
                    }}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    "px-1.5 py-1 text-left",
                    "font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest",
                    "whitespace-nowrap",
                    col.sortable && "cursor-pointer select-none hover:text-text-secondary transition-colors"
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable ? () => handleSort(col.id) : undefined}
                  aria-sort={
                    sortColumn === col.id && sortDirection
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-0.5">
                    {col.header}
                    {col.sortable && (
                      <span className="text-text-disabled">
                        {sortColumn === col.id && sortDirection === "asc" ? (
                          <ArrowUp className="h-[14px] w-[14px] text-ops-accent" />
                        ) : sortColumn === col.id && sortDirection === "desc" ? (
                          <ArrowDown className="h-[14px] w-[14px] text-ops-accent" />
                        ) : (
                          <ArrowUpDown className="h-[14px] w-[14px]" />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} colCount={totalCols} />
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="py-6 text-center">
                  <div className="flex flex-col items-center gap-1 text-text-tertiary">
                    {emptyIcon}
                    <span className="font-mohave text-body-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const key = String(row[keyField]);
                const isSelected = selectedKeys.has(key);
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-b border-border-subtle",
                      "transition-colors duration-100",
                      "hover:bg-background-elevated/50",
                      isSelected && "bg-ops-accent-muted"
                    )}
                  >
                    {selectable && (
                      <td className="w-[40px] px-1 py-1">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSelectRow(key)}
                          aria-label={`Select row ${key}`}
                        />
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          "px-1.5 py-1.5",
                          "text-body-sm text-text-primary",
                          col.mono && "font-mono text-data-sm"
                        )}
                      >
                        {getCellValue(row, col)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center justify-center gap-1 py-1 text-text-tertiary">
          <Loader2 className="h-[16px] w-[16px] animate-spin" />
          <span className="text-caption-sm font-mohave">Loading data...</span>
        </div>
      )}

      {/* Pagination */}
      {onPageChange && totalPages > 1 && (
        <div className="flex items-center justify-between gap-1 pt-0.5">
          <span className="text-caption-sm text-text-tertiary font-mono">
            Page {page} of {totalPages} ({total} records)
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              aria-label="First page"
            >
              <ChevronsLeft className="h-[16px] w-[16px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-[16px] w-[16px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-[16px] w-[16px]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              aria-label="Last page"
            >
              <ChevronsRight className="h-[16px] w-[16px]" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Wrapper to support generics with forwardRef
const DataTable = React.forwardRef(DataTableInner) as unknown as <T>(
  props: DataTableProps<T> & { ref?: React.Ref<HTMLDivElement> }
) => React.ReactElement;

export { DataTable };
