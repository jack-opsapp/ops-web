"use client";

import { Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";

/**
 * Projects grid tools cluster — the row count readout + density control +
 * view-settings menu. Rendered in the shared `Workbar`'s `tools` slot (right
 * cluster); search lives in the `Workbar`'s `search` slot and the saved-view
 * tabs in its row-2 tab strip, so this no longer owns the toolbar layout.
 */
export function ProjectsToolbar({
  rowCount,
  totalCount,
  densityControl,
  viewSettings,
}: {
  rowCount: number;
  totalCount: number;
  densityControl?: ReactNode;
  viewSettings?: ReactNode;
}) {
  const { t } = useDictionary("projects");

  return (
    <>
      <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-text-3">
        <Rows3 className="h-[12px] w-[12px]" strokeWidth={1.5} />
        {t("table.toolbar.rows")
          .replace("{count}", String(rowCount))
          .replace("{total}", String(totalCount))}
      </span>
      {densityControl}
      {viewSettings}
    </>
  );
}
