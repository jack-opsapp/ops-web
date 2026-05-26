"use client";

import { Search, Rows3 } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useDictionary } from "@/i18n/client";

export function ProjectsToolbar({
  search,
  onSearchChange,
  rowCount,
  totalCount,
  searchInputRef,
  densityControl,
  viewSettings,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  rowCount: number;
  totalCount: number;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  densityControl?: ReactNode;
  viewSettings?: ReactNode;
}) {
  const { t } = useDictionary("projects");

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-0 py-[4px]">
      <label className="flex h-[28px] min-w-[220px] flex-1 items-center gap-1.5 rounded-[5px] border border-border bg-surface-input px-2 focus-within:ring-1 focus-within:ring-ops-accent">
        <Search className="h-[12px] w-[12px] shrink-0 text-text-3" strokeWidth={1.5} />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("table.toolbar.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] uppercase text-text outline-none placeholder:text-text-3"
        />
      </label>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-text-3">
          <span className="inline-flex items-center gap-1">
            <Rows3 className="h-[12px] w-[12px]" strokeWidth={1.5} />
            {t("table.toolbar.rows")
              .replace("{count}", String(rowCount))
              .replace("{total}", String(totalCount))}
          </span>
        </div>
        {densityControl}
        {viewSettings}
      </div>
    </div>
  );
}
