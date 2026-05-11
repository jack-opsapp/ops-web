"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Phase B rebuild: tactical voice. Drops the boxed "Inbox" h2 + Filter/Search
 * lucide icons. Header now reads as `// INBOX  [ALL ▾]  ⋯` with a single-line
 * `[search threads — ⌘K]` placeholder button below. Brackets/glyphs carry the
 * affordance — no decorative icons. Spec § 4 punch list rows.
 */

import { MoreHorizontal } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "./voice/slash-label";

interface ThreadColumnHeaderProps {
  filterLabel?: string;
  onOpenFilter?: () => void;
  onOpenMore?: () => void;
  onOpenSearch?: () => void;
  className?: string;
}

export function ThreadColumnHeader({
  filterLabel,
  onOpenFilter,
  onOpenMore,
  onOpenSearch,
  className,
}: ThreadColumnHeaderProps) {
  const { t } = useDictionary("inbox");
  return (
    <div
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3.5 py-3.5">
        <SlashLabel
          label={t("panel.title", "// INBOX")}
          size="sm"
          tone="text-2"
          className="flex-1"
        />
        <button
          type="button"
          onClick={onOpenFilter}
          aria-label={t("column.filter", "Filter inbox")}
          className="inline-flex items-center gap-1 rounded-chip border border-line px-2 py-[3px] font-mono text-[11px] uppercase tracking-[0.16em] text-text-2 hover:border-line-hi hover:text-text"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {filterLabel ?? t("filter.allChip", "[ALL ▾]")}
        </button>
        <button
          type="button"
          onClick={onOpenMore}
          aria-label={t("more.actions", "More actions")}
          className="text-text-mute hover:text-text-2 p-1"
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="px-3.5 pb-3 -mt-1">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={t("column.search", "Search inbox")}
          className="block w-full rounded-[4px] border border-line bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 text-left font-mono text-[11px] text-text-mute hover:border-line-hi focus:border-line-hi focus:outline-none"
        >
          {t("search.tacticPlaceholder", "[search threads — ⌘K]")}
        </button>
      </div>
    </div>
  );
}
