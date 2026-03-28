"use client";

import { useState, useCallback, useMemo } from "react";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export function useSortState(defaultKey: string, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState>({ key: defaultKey, dir: defaultDir });

  const toggle = useCallback(
    (key: string) => {
      setSort((prev) =>
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: "desc" }
      );
    },
    []
  );

  const sorted = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <T extends Record<string, any>>(rows: T[]): T[] => {
      return [...rows].sort((a, b) => {
        const aVal = a[sort.key];
        const bVal = b[sort.key];
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        const cmp =
          typeof aVal === "number" && typeof bVal === "number"
            ? aVal - bVal
            : String(aVal).localeCompare(String(bVal));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    },
    [sort]
  );

  return { sort, toggle, sorted };
}

interface SortableTableHeaderProps {
  columns: { key: string; label: string; sortable?: boolean }[];
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTableHeader({
  columns,
  sort,
  onSort,
  className = "",
}: SortableTableHeaderProps) {
  return (
    <tr className={`border-b border-white/[0.08] ${className}`}>
      {columns.map((col) => (
        <th
          key={col.key}
          className={`py-2 text-left font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B] pr-3 ${
            col.sortable !== false ? "cursor-pointer select-none hover:text-[#A0A0A0]" : ""
          }`}
          onClick={col.sortable !== false ? () => onSort(col.key) : undefined}
        >
          <span className="inline-flex items-center gap-1">
            {col.label}
            {col.sortable !== false && sort.key === col.key && (
              <span className="text-[#597794]">
                {sort.dir === "asc" ? "\u2191" : "\u2193"}
              </span>
            )}
          </span>
        </th>
      ))}
    </tr>
  );
}
