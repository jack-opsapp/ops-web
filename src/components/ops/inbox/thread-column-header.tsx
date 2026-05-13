"use client";

/**
 * ThreadColumnHeader — top of the left column.
 *
 * Phase B rebuild: tactical voice. Drops the boxed "Inbox" h2 + Filter/Search
 * lucide icons. Header reads as `// INBOX  [ALL ▾]  ⋯` with a single-line
 * `[search threads — ⌘K]` placeholder button below.
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
import type { InboxRail } from "@/lib/types/email-thread";
import { SlashLabel } from "./voice/slash-label";

interface ThreadColumnHeaderProps {
  /**
   * Current rail filter. The chip's label tracks this — `everything → ALL`,
   * `needs_reply → NEEDS REPLY`, etc.
   */
  filter: InboxRail;
  onFilterChange: (filter: InboxRail) => void;
  /** Invoked when the operator wants to search threads — fires ⌘K. */
  onOpenSearch: () => void;
  /** Manual refresh — invalidates the threads query. */
  onRefresh: () => void;
  /** Navigate to the archived rail (filter='done' with archived view). */
  onOpenArchived: () => void;
  /** Navigate to inbox settings. */
  onOpenSettings: () => void;
  className?: string;
}

const FILTER_LABEL_KEY: Record<InboxRail, string> = {
  everything: "filter.rail.everything",
  needs_reply: "filter.rail.needsReply",
  drafts: "filter.rail.drafts",
  commitments: "filter.rail.commitments",
  scheduled: "filter.rail.scheduled",
  done: "filter.rail.done",
};

const FILTER_LABEL_FALLBACK: Record<InboxRail, string> = {
  everything: "ALL",
  needs_reply: "NEEDS REPLY",
  drafts: "DRAFTS",
  commitments: "COMMITMENTS",
  scheduled: "SCHEDULED",
  done: "DONE",
};

const FILTER_OPTIONS: ReadonlyArray<InboxRail> = [
  "everything",
  "needs_reply",
  "drafts",
  "commitments",
  "scheduled",
  "done",
];

export function ThreadColumnHeader({
  filter,
  onFilterChange,
  onOpenSearch,
  onRefresh,
  onOpenArchived,
  onOpenSettings,
  className,
}: ThreadColumnHeaderProps) {
  const { t } = useDictionary("inbox");
  const activeLabel = t(
    FILTER_LABEL_KEY[filter],
    FILTER_LABEL_FALLBACK[filter],
  );
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
              value={filter}
              onValueChange={(v) => onFilterChange(v as InboxRail)}
            >
              {FILTER_OPTIONS.map((rail) => (
                <DropdownMenuRadioItem
                  key={rail}
                  value={rail}
                  className="font-mono text-[11px] uppercase tracking-[0.16em]"
                >
                  {t(FILTER_LABEL_KEY[rail], FILTER_LABEL_FALLBACK[rail])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

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
