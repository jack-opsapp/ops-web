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
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
      <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 focus-within:border-ops-accent">
        <Search className="h-4 w-4 shrink-0 text-text-3" />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("table.toolbar.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-3"
        />
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-3 font-mono text-micro uppercase tracking-wider text-text-3">
          <span className="inline-flex items-center gap-1">
            <Rows3 className="h-3.5 w-3.5" />
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
