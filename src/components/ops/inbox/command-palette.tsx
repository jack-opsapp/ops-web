"use client";

/**
 * CommandPalette — Cmd+K overlay over the inbox.
 *
 * Two panes:
 *   - When the query is empty: groups of "commands" (archive thread, snooze,
 *     recategorize, compose new, jump to rail, etc.).
 *   - When the user types: a "threads" group appears above commands, showing
 *     live search hits from useInboxThreads({ filter: "ALL", search }).
 *
 * Selecting a thread opens it. Selecting a command invokes the provided
 * handler — most commands require a current thread and are hidden when none
 * is selected. Pressing Escape or clicking outside closes.
 *
 * The route owns the Cmd+K listener so it can suppress the dashboard-wide
 * command palette while the inbox is mounted.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Clock,
  Inbox,
  Mail,
  Plus,
  Sparkles,
  Tag,
  Hash,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { KeyHint } from "@/components/ui/key-hint";
import { useDictionary } from "@/i18n/client";
import {
  EMAIL_THREAD_CATEGORIES,
  type EmailThreadCategory,
} from "@/lib/types/email-thread";
import type { RailFilter } from "@/lib/inbox/rail-predicates";
import { useInboxThreads } from "@/lib/hooks/use-inbox-threads";
import { categoryLabel } from "./category-chip";

// ─── Command definitions ─────────────────────────────────────────────────────

export interface CommandPaletteHandlers {
  onOpenThread: (threadId: string) => void;
  onSwitchRail: (rail: RailFilter) => void;
  onFilterCategory?: (category: EmailThreadCategory | null) => void;
  onArchive?: () => void;
  onSnooze?: () => void;
  onRecategorizeOpen?: () => void;
  onMarkUnread?: () => void;
  onAIDraft?: () => void;
  onComposeNew?: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "own" | "company";
  /** Current selected thread id (null when viewing the list only). */
  selectedThreadId: string | null;
  handlers: CommandPaletteHandlers;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
  scope,
  selectedThreadId,
  handlers,
}: CommandPaletteProps) {
  const { t } = useDictionary("inbox");
  const [query, setQuery] = useState("");

  // Reset the query each time the palette reopens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // Search hits — only query the API when we have something to search.
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;
  const { data: searchPages, isFetching: searchLoading } = useInboxThreads({
    scope,
    filter: "ALL",
    search: searching ? trimmed : undefined,
  });

  const searchHits = useMemo(() => {
    if (!searching || !searchPages) return [];
    const all = searchPages.pages.flatMap((p) => p.threads);
    return all.slice(0, 10);
  }, [searching, searchPages]);

  const run = (fn: (() => void) | undefined) => {
    if (!fn) return;
    onOpenChange(false);
    // Defer so the dialog closes before the handler fires.
    setTimeout(fn, 0);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t(
          "commandPalette.placeholder",
          "Search threads · run a command"
        )}
        onClear={query ? () => setQuery("") : undefined}
      />

      <CommandList>
        <CommandEmpty>
          {searchLoading
            ? t("commandPalette.searching", "Searching…")
            : t("commandPalette.empty", "Nothing matches that.")}
        </CommandEmpty>

        {/* Thread search hits */}
        {searching && searchHits.length > 0 && (
          <>
            <CommandGroup
              heading={t("commandPalette.heading.threads", "Threads")}
            >
              {searchHits.map((thread) => (
                <CommandItem
                  key={thread.id}
                  value={`thread:${thread.id} ${thread.subject} ${thread.latestSnippet ?? ""} ${thread.clientName ?? thread.latestSenderName ?? ""}`}
                  onSelect={() => run(() => handlers.onOpenThread(thread.id))}
                >
                  <Mail
                    className="h-[14px] w-[14px] shrink-0 text-text-3"
                    strokeWidth={1.5}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mohave text-body-sm text-text">
                      {thread.subject || t("detail.untitled", "(no subject)")}
                    </span>
                    <span className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-text-mute">
                      {thread.clientName ??
                        thread.latestSenderName ??
                        thread.latestSenderEmail ??
                        t("commandPalette.unknownSender", "Unknown")}
                      {" · "}
                      {categoryLabel(thread.primaryCategory)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Thread actions (require a selected thread) */}
        {selectedThreadId &&
          (handlers.onArchive ||
            handlers.onSnooze ||
            handlers.onRecategorizeOpen ||
            handlers.onMarkUnread ||
            handlers.onAIDraft) && (
            <>
              <CommandGroup
                heading={t("commandPalette.heading.thisThread", "This thread")}
              >
                {handlers.onArchive && (
                  <CommandItem
                    value="archive thread e"
                    onSelect={() => run(handlers.onArchive)}
                  >
                    <Archive
                      className="h-[14px] w-[14px] text-text-3"
                      strokeWidth={1.5}
                    />
                    {t("commandPalette.cmd.archive", "Archive thread")}
                    <span className="ml-auto">
                      <KeyHint keys="E" />
                    </span>
                  </CommandItem>
                )}
                {handlers.onSnooze && (
                  <CommandItem
                    value="snooze thread s"
                    onSelect={() => run(handlers.onSnooze)}
                  >
                    <Clock
                      className="h-[14px] w-[14px] text-text-3"
                      strokeWidth={1.5}
                    />
                    {t("commandPalette.cmd.snooze", "Snooze thread")}
                    <span className="ml-auto">
                      <KeyHint keys="S" />
                    </span>
                  </CommandItem>
                )}
                {handlers.onRecategorizeOpen && (
                  <CommandItem
                    value="recategorize thread l"
                    onSelect={() => run(handlers.onRecategorizeOpen)}
                  >
                    <Tag
                      className="h-[14px] w-[14px] text-text-3"
                      strokeWidth={1.5}
                    />
                    {t(
                      "commandPalette.cmd.recategorize",
                      "Recategorize thread"
                    )}
                    <span className="ml-auto">
                      <KeyHint keys="L" />
                    </span>
                  </CommandItem>
                )}
                {handlers.onMarkUnread && (
                  <CommandItem
                    value="mark unread u"
                    onSelect={() => run(handlers.onMarkUnread)}
                  >
                    <Mail
                      className="h-[14px] w-[14px] text-text-3"
                      strokeWidth={1.5}
                    />
                    {t("commandPalette.cmd.markUnread", "Mark as unread")}
                    <span className="ml-auto">
                      <KeyHint keys="U" />
                    </span>
                  </CommandItem>
                )}
                {handlers.onAIDraft && (
                  <CommandItem
                    value="ai draft phase c"
                    onSelect={() => run(handlers.onAIDraft)}
                  >
                    <Sparkles
                      className="h-[14px] w-[14px] text-text-3"
                      strokeWidth={1.5}
                    />
                    {t(
                      "commandPalette.cmd.aiDraft",
                      "Ask Phase C to draft a reply"
                    )}
                    <span className="ml-auto">
                      <KeyHint keys={["⇧", "D"]} />
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

        {/* Navigation */}
        <CommandGroup
          heading={t("commandPalette.heading.navigate", "Navigate")}
        >
          <CommandItem
            value="all 1"
            onSelect={() => run(() => handlers.onSwitchRail("ALL"))}
          >
            <Inbox
              className="h-[14px] w-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.all", "Go to All")}
            <span className="ml-auto">
              <KeyHint keys="1" />
            </span>
          </CommandItem>
          <CommandItem
            value="your move 2"
            onSelect={() => run(() => handlers.onSwitchRail("YOUR_MOVE"))}
          >
            <Inbox
              className="h-[14px] w-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.yourMove", "Go to Your Move")}
            <span className="ml-auto">
              <KeyHint keys="2" />
            </span>
          </CommandItem>
          <CommandItem
            value="waiting 3"
            onSelect={() => run(() => handlers.onSwitchRail("WAITING"))}
          >
            <Clock
              className="h-[14px] w-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.waiting", "Go to Waiting")}
            <span className="ml-auto">
              <KeyHint keys="3" />
            </span>
          </CommandItem>
          <CommandItem
            value="archived 4"
            onSelect={() => run(() => handlers.onSwitchRail("ARCHIVED"))}
          >
            <Archive
              className="h-[14px] w-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.archived", "Go to Archived")}
            <span className="ml-auto">
              <KeyHint keys="4" />
            </span>
          </CommandItem>
          {handlers.onFilterCategory && (
            <CommandItem
              value="all categories"
              onSelect={() => run(() => handlers.onFilterCategory?.(null))}
            >
              <Hash
                className="h-[14px] w-[14px] text-text-3"
                strokeWidth={1.5}
              />
              {t("commandPalette.nav.clearFilter", "Clear category filter")}
            </CommandItem>
          )}
        </CommandGroup>

        {handlers.onFilterCategory && (
          <>
            <CommandSeparator />

            {/* Category filters */}
            <CommandGroup
              heading={t(
                "commandPalette.heading.filterCategory",
                "Filter category"
              )}
            >
              {EMAIL_THREAD_CATEGORIES.map((cat) => (
                <CommandItem
                  key={cat}
                  value={`filter ${categoryLabel(cat)}`}
                  onSelect={() => run(() => handlers.onFilterCategory?.(cat))}
                >
                  <Hash
                    className="h-[14px] w-[14px] text-text-3"
                    strokeWidth={1.5}
                  />
                  {t(
                    "commandPalette.filter.only",
                    "Only show {category}"
                  ).replace("{category}", categoryLabel(cat))}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {handlers.onComposeNew && <CommandSeparator />}

        {/* Other */}
        {handlers.onComposeNew && (
          <CommandGroup heading={t("commandPalette.heading.create", "Create")}>
            <CommandItem
              value="compose new email c"
              onSelect={() => run(handlers.onComposeNew)}
            >
              <Plus
                className="h-[14px] w-[14px] text-text-3"
                strokeWidth={1.5}
              />
              {t("commandPalette.cmd.composeNew", "Compose new email")}
              <span className="ml-auto">
                <KeyHint keys="C" />
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
