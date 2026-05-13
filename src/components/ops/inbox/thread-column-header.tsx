"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Reads as `// INBOX  [ALL ▾]  ⋯` with a single-line `[search threads — ⌘K]`
 * placeholder button below. The filter dropdown selects between the four
 * operator-facing rails — ALL / YOUR MOVE / WAITING / ARCHIVED. SNOOZED
 * lives behind the header chip surface (see thread-column-snooze-chip,
 * commit 4 of the rail-collapse series); DRAFTS lives behind the dedicated
 * drafts header chip (commit 3).
 *
 * Filter + More buttons render Radix DropdownMenus inline so the header is
 * self-contained — the parent passes the *current* filter and the change
 * callback, the More menu invokes router/refresh handlers. Search is a
 * lightweight trigger; the canonical search surface is the global ⌘K
 * command palette mounted in dashboard-layout.tsx.
 */

import { MoreHorizontal } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RAIL_NAV_OPTIONS,
  type RailFilter,
} from "@/lib/inbox/rail-predicates";
import { SlashLabel } from "./voice/slash-label";

interface ThreadColumnHeaderProps {
  /**
   * Current rail filter. The chip's label tracks this — `ALL → ALL`,
   * `YOUR_MOVE → YOUR MOVE`, etc.
   */
  filter: RailFilter;
  onFilterChange: (filter: RailFilter) => void;
  /** Invoked when the operator wants to search threads — fires ⌘K. */
  onOpenSearch: () => void;
  /** Manual refresh — invalidates the threads query. */
  onRefresh: () => void;
  /** Navigate to the archived rail. */
  onOpenArchived: () => void;
  /** Navigate to inbox settings. */
  onOpenSettings: () => void;
  /**
   * Optional slot rendered between the filter dropdown and the More menu.
   * Used by InboxRoute to insert the header chips for DRAFTS and SNOOZED
   * (counter pills shown only when their respective counts exceed zero —
   * see commits 3 and 4 in the rail-collapse series).
   */
  headerChipSlot?: React.ReactNode;
  className?: string;
}

const NAV_LABEL_KEY: Record<Exclude<RailFilter, "SNOOZED">, string> = {
  ALL: "filter.rail.all",
  YOUR_MOVE: "filter.rail.yourMove",
  WAITING: "filter.rail.waiting",
  ARCHIVED: "filter.rail.archived",
};

const NAV_LABEL_FALLBACK: Record<Exclude<RailFilter, "SNOOZED">, string> = {
  ALL: "ALL",
  YOUR_MOVE: "YOUR MOVE",
  WAITING: "WAITING",
  ARCHIVED: "ARCHIVED",
};

function navRail(filter: RailFilter): Exclude<RailFilter, "SNOOZED"> {
  // SNOOZED is not a rail tab — when the route reports it (popover-driven),
  // the operator-visible chip still shows the previous rail context, which
  // defaults to ALL for an unknown landing.
  return filter === "SNOOZED" ? "ALL" : filter;
}

export function ThreadColumnHeader({
  filter,
  onFilterChange,
  onOpenSearch,
  onRefresh,
  onOpenArchived,
  onOpenSettings,
  headerChipSlot,
  className,
}: ThreadColumnHeaderProps) {
  const { t } = useDictionary("inbox");
  const navFilter = navRail(filter);
  const activeLabel = t(NAV_LABEL_KEY[navFilter], NAV_LABEL_FALLBACK[navFilter]);
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("column.filter", "Filter inbox")}
              className="inline-flex items-center gap-1 rounded-chip border border-line px-2 py-[3px] font-mono text-[11px] uppercase tracking-[0.16em] text-text-2 hover:border-line-hi hover:text-text data-[state=open]:border-line-hi data-[state=open]:text-text"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              [{activeLabel} ▾]
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[180px]">
            <DropdownMenuRadioGroup
              value={navFilter}
              onValueChange={(v) => onFilterChange(v as RailFilter)}
            >
              {RAIL_NAV_OPTIONS.map((rail) => (
                <DropdownMenuRadioItem
                  key={rail}
                  value={rail}
                  className="font-mono text-[11px] uppercase tracking-[0.16em]"
                >
                  {t(NAV_LABEL_KEY[rail], NAV_LABEL_FALLBACK[rail])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {headerChipSlot}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("more.menuLabel", "More inbox actions")}
              className="text-text-mute hover:text-text-2 data-[state=open]:text-text-2 p-1"
            >
              <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[200px]">
            <DropdownMenuItem
              onSelect={() => onRefresh()}
              className="font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              {t("more.refresh", "REFRESH")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onOpenArchived()}
              className="font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              {t("more.archive", "ARCHIVED THREADS")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onOpenSettings()}
              className="font-mono text-[11px] uppercase tracking-[0.16em]"
            >
              {t("more.settings", "INBOX SETTINGS")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
