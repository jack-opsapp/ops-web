"use client";

import { useDictionary } from "@/i18n/client";
import type { GrandTotal } from "@/lib/utils/pipeline-table-grouping";
import {
  formatCurrency,
  formatNumber,
} from "@/lib/utils/pipeline-table-formatters";

/**
 * Grand-total footer bar for the pipeline table. Always rendered below the
 * table (grouped or flat), pinned to the bottom of the table-mode surface. Shows
 * the aggregate across every in-scope row: deal count · total value. When
 * grouped, this equals the sum of the visible stage rollups.
 *
 * Numbers are mono + tabular + formatted; labels follow OPS voice (`//` deal
 * count, `[bracket]` metric labels). Borders-only, no shadow — a quiet `border-t`
 * band over the canvas, distinct from the data rows above it.
 */
export function PipelineTableFooter({ total }: { total: GrandTotal }) {
  const { t } = useDictionary("pipeline");

  return (
    <div
      role="row"
      aria-label={t("table.footer.label")}
      className="flex shrink-0 items-center gap-4 border-t border-border bg-background px-[8px] py-[6px]"
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
        {t("table.footer.deals").replace("{count}", formatNumber(total.count))}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-4 font-mono text-[11px] uppercase tabular-nums tracking-[0.16em]">
        <span className="flex items-center gap-1.5">
          <span className="text-text-mute">{t("table.footer.value")}</span>
          <span className="text-text">{formatCurrency(total.sumValue)}</span>
        </span>
      </span>
    </div>
  );
}
