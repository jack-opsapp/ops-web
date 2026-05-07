"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Faithful to `reference/v4-states.jsx :: V4Column` header block:
 *   • Title row: "Inbox" h2 (Mohave 17 / 500), filter pill, more button
 *   • Search bar below (compact 30px, ⌘K hint)
 *
 * The filter pill is a presentational shell here — actual filter wiring
 * is downstream of this component (the InboxRoute owns scope + filter).
 */

import { ChevronDown, Filter, MoreHorizontal, Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { KeyHint } from "@/components/ui/key-hint";
import { cn } from "@/lib/utils/cn";

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
        "shrink-0 border-b border-line bg-inbox-panel px-3.5 pb-2.5 pt-3.5",
        className,
      )}
    >
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="m-0 font-mohave text-[17px] font-medium tracking-[-0.005em] text-text">
          {t("column.title", "Inbox")}
        </h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenFilter}
          aria-label={t("column.filter", "Filter inbox")}
          className="inline-flex h-[22px] items-center gap-1.5 rounded-chip border border-line bg-transparent px-2 font-mohave text-[11px] text-text-3 hover:border-line-hi hover:text-text-2"
        >
          <Filter aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} />
          <span>{filterLabel ?? t("column.filterAll", "All")}</span>
          <ChevronDown aria-hidden className="h-[9px] w-[9px]" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onOpenMore}
          aria-label={t("column.more", "More options")}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-chip border border-line bg-transparent text-text-3 hover:border-line-hi hover:text-text-2"
        >
          <MoreHorizontal aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("column.search", "Search inbox")}
        className="flex h-[30px] w-full items-center gap-2 rounded-md border border-line bg-inbox-bg-deep px-2.5 text-left transition-colors hover:border-line-hi"
      >
        <Search
          aria-hidden
          className="h-3 w-3 shrink-0 text-text-mute"
          strokeWidth={1.75}
        />
        <span className="flex-1 truncate font-mohave text-[12.5px] text-text-mute">
          {t("column.searchPlaceholder", "Search inbox…")}
        </span>
        <KeyHint keys={["⌘", "K"]} variant="chip" />
      </button>
    </div>
  );
}
