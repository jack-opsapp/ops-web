"use client";

import { useDictionary } from "@/i18n/client";
import { formatDate } from "@/lib/utils/pipeline-table-formatters";

/**
 * Site-visit cell — one glance at where this lead sits with the operator's
 * calendar, in the order the owner cares about:
 *
 *   Aug 25        an upcoming booked visit (the thing they can still act on)
 *   DONE Aug 12   no visit ahead, but one already happened
 *   —             neither
 *
 * The two states are distinguished by the DONE prefix, not by color alone, so
 * the reading survives a monochrome scan. Dates reuse the table's shared
 * `formatDate` (and its `—` sentinel), keeping this column byte-identical in
 * rhythm to the other date columns.
 */
export function CellSiteVisit({
  nextAt,
  completedAt,
}: {
  nextAt: string | null;
  completedAt: string | null;
}) {
  const { t } = useDictionary("pipeline");

  if (nextAt) {
    return (
      <span className="block truncate font-mono tabular-nums text-text-2">
        {formatDate(nextAt)}
      </span>
    );
  }

  if (completedAt) {
    return (
      <span className="flex min-w-0 items-center gap-1 font-mono text-text-3">
        <span className="shrink-0 uppercase tracking-[0.12em] text-text-mute">
          {t("table.cell.siteVisit.done", "Done")}
        </span>
        <span className="truncate tabular-nums">{formatDate(completedAt)}</span>
      </span>
    );
  }

  return (
    <span className="block truncate font-mono tabular-nums text-text-2">
      {formatDate(null)}
    </span>
  );
}
