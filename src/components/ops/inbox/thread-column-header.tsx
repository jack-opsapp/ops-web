"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Compact audience rails + a live search input that filters threads in-place
 * within the active rail. The filter dropdown selects between the three
 * primary IA rails — CLIENTS / EVERYTHING ELSE / ALL. SNOOZED lives behind
 * the header chip surface; ARCHIVED remains a More action. DRAFTS lives
 * behind the dedicated drafts header chip.
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

import { X, MoreHorizontal, Pin } from "lucide-react";
import { useRef } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/ui/search-input";
import {
  RAIL_NAV_OPTIONS,
  type InboxPrimaryRail,
  type RailFilter,
} from "@/lib/inbox/rail-predicates";

interface ThreadColumnHeaderProps {
  /**
   * Current rail filter. The chip's label tracks this — `CLIENTS → CLIENTS`,
   * `EVERYTHING_ELSE → EVERYTHING ELSE`, etc.
   */
  filter: RailFilter;
  onFilterChange: (filter: RailFilter) => void;
  /** Primary rail pinned as the default-open view. */
  defaultFilter: InboxPrimaryRail;
  onDefaultFilterChange: (filter: InboxPrimaryRail) => void;
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

const NAV_LABEL_KEY: Record<InboxPrimaryRail | "ARCHIVED", string> = {
  CLIENTS: "filter.rail.clients",
  EVERYTHING_ELSE: "filter.rail.everythingElse",
  ALL: "filter.rail.all",
  ARCHIVED: "filter.rail.archived",
};

const NAV_LABEL_FALLBACK: Record<InboxPrimaryRail | "ARCHIVED", string> = {
  CLIENTS: "CLIENTS",
  EVERYTHING_ELSE: "EVERYTHING ELSE",
  ALL: "ALL",
  ARCHIVED: "ARCHIVED",
};

function activeRailLabel(filter: RailFilter): InboxPrimaryRail | "ARCHIVED" {
  // SNOOZED is not a rail tab — when a utility surface reports it, the
  // operator-visible chip degrades to ALL because snooze is row state.
  return filter === "SNOOZED" ? "ALL" : filter;
}

export function ThreadColumnHeader({
  filter,
  onFilterChange,
  defaultFilter,
  onDefaultFilterChange,
  searchValue,
  onSearchChange,
  onRefresh,
  onOpenArchived,
  onOpenSettings,
  headerChipSlot,
  className,
}: ThreadColumnHeaderProps) {
  const { t } = useDictionary("inbox");
  const suppressRailSelectRef = useRef(false);
  const activeRail = activeRailLabel(filter);
  const activeLabel = t(NAV_LABEL_KEY[activeRail], NAV_LABEL_FALLBACK[activeRail]);
  return (
    <div
      data-inbox-debug-id="B1"
      data-inbox-debug-label="THREAD FILTERS + SEARCH"
      className={cn(
        "shrink-0 overflow-hidden border-b border-line",
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
              {RAIL_NAV_OPTIONS.map((rail) => {
                const label = t(NAV_LABEL_KEY[rail], NAV_LABEL_FALLBACK[rail]);
                const isDefault = defaultFilter === rail;
                return (
                  <DropdownMenuItem
                    key={rail}
                    onSelect={(event) => {
                      if (suppressRailSelectRef.current) {
                        suppressRailSelectRef.current = false;
                        event.preventDefault();
                        return;
                      }
                      onFilterChange(rail);
                    }}
                    className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]"
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <button
                      data-default-filter-pin
                      type="button"
                      aria-label={
                        isDefault
                          ? t(
                              "filter.defaultCurrent",
                              "Default inbox view: {filter}",
                            ).replace("{filter}", label)
                          : t(
                              "filter.setDefault",
                              "Set {filter} as default inbox view",
                            ).replace("{filter}", label)
                      }
                      aria-pressed={isDefault}
                      title={
                        isDefault
                          ? t(
                              "filter.defaultCurrent",
                              "Default inbox view: {filter}",
                            ).replace("{filter}", label)
                          : t(
                              "filter.setDefault",
                              "Set {filter} as default inbox view",
                            ).replace("{filter}", label)
                      }
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        suppressRailSelectRef.current = true;
                        onDefaultFilterChange(rail);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        suppressRailSelectRef.current = true;
                        onDefaultFilterChange(rail);
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      className={cn(
                        "pointer-events-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-bar text-text-mute hover:text-text",
                        isDefault && "text-text",
                      )}
                    >
                      <Pin
                        aria-hidden
                        className={cn("h-3 w-3", isDefault && "fill-current")}
                        strokeWidth={1.5}
                      />
                    </button>
                  </DropdownMenuItem>
                );
              })}
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
