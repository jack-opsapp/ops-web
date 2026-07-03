"use client";

import { Rows3 } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { WorkbarCount } from "@/components/ui/table-shell";

/**
 * Projects row-count readout — for the shared `Workbar`'s `meta` slot (the one
 * home for counts across every surface). Split out of the tools cluster in
 * REWORK 7 so the count lands in the same spot as Books/Catalog.
 */
export function ProjectsRowCount({
  rowCount,
  totalCount,
}: {
  rowCount: number;
  totalCount: number;
}) {
  const { t } = useDictionary("projects");
  return (
    <WorkbarCount icon={<Rows3 className="h-[12px] w-[12px]" strokeWidth={1.5} />}>
      {t("table.toolbar.rows")
        .replace("{count}", String(rowCount))
        .replace("{total}", String(totalCount))}
    </WorkbarCount>
  );
}

/**
 * Projects grid tools cluster — density control + view-settings menu. Rendered
 * in the shared `Workbar`'s `tools` slot (right cluster). The row count moved
 * to the `meta` slot (REWORK 7); search lives in `search` and the saved-view
 * tabs in the row-2 tab strip.
 */
export function ProjectsToolbar({
  densityControl,
  viewSettings,
}: {
  densityControl?: ReactNode;
  viewSettings?: ReactNode;
}) {
  return (
    <>
      {densityControl}
      {viewSettings}
    </>
  );
}
