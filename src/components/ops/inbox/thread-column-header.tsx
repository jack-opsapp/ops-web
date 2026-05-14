"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Compact rail controls + a live search input that filters threads in-place
 * within the active rail. The filter dropdown selects
 * between the four operator-facing rails — ALL / YOUR MOVE / WAITING /
 * ARCHIVED. SNOOZED lives behind the header chip surface (see
 * thread-column-snooze-chip); DRAFTS lives behind the dedicated drafts
 * header chip.
 *
 * Search behavior — header input filters the current rail in place
 * (subject / latest snippet / sender name / sender email ILIKE). The global
 * ⌘K command palette (dashboard-layout.tsx) still owns cross-app navigation
 * + categorical filtering, and remains accessible via the ⌘K keyboard
 * shortcut. The two affordances are intentionally distinct.
 *
 * Filter + More buttons render Radix DropdownMenus inline so the header is
 * self-contained — the parent passes the current filter / search value and
 * the change callbacks.
 */

import { X, MoreHorizontal } from "lucide-react";
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
import { SearchInput } from "@/components/ui/search-input";
import {
  RAIL_NAV_OPTIONS,
  type RailFilter,
} from "@/lib/inbox/rail-predicates";

interface ThreadColumnHeaderProps {
  /**
   * Current rail filter. The chip's label tracks this — `ALL → ALL`,
   * `YOUR_MOVE → YOUR MOVE`, etc.
   */
  filter: RailFilter;
  onFilterChange: (filter: RailFilter) => void;
  /**
   * Current value of the in-place search input. The parent owns the debounced
   * URL writeback + threads-query trigger; this component is purely
   * controlled.
   */
  searchValue: string;
  onSearchChange: (value: string) => void;
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
  searchValue,
  onSearchChange,
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
      data-inbox-debug-id="B1"
      data-inbox-debug-label="THREAD FILTERS + SEARCH"
      className={cn(
        "shrink-0 border-b border-line bg-inbox-panel",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("column.filter", "Filter inbox")}
                className="inline-flex min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-chip border border-line px-1.5 py-[2px] font-mono text-[11px] uppercase tracking-[0.16em] text-text-2 hover:border-line-hi hover:text-text data-[state=open]:border-line-hi data-[state=open]:text-text"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <span className="truncate">[{activeLabel} ▾]</span>
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

          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {headerChipSlot}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("more.menuLabel", "More inbox actions")}
              className="shrink-0 p-0.5 text-text-mute hover:text-text-2 data-[state=open]:text-text-2"
            >
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
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
      <div className="px-2.5 pb-1.5">
        <div className="relative">
          <SearchInput
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchValue.length > 0) {
                e.preventDefault();
                onSearchChange("");
              }
            }}
            aria-label={t("column.search", "Search inbox")}
            placeholder={t("search.tacticPlaceholder", "[search threads]")}
            wrapperClassName="w-full"
            className="!h-5 !py-0 pr-6 !leading-5"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {searchValue.length > 0 ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label={t("search.clear", "Clear search")}
              className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center justify-center text-text-mute hover:text-text-2"
            >
              <X aria-hidden className="h-3 w-3" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
