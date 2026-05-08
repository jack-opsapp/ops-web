"use client";

/**
 * CommandPalette — Cmd+K overlay over the inbox.
 *
 * Two panes:
 *   - When the query is empty: groups of "commands" (archive thread, snooze,
 *     recategorize, compose new, jump to rail, etc.).
 *   - When the user types: a "threads" group appears above commands, showing
 *     live search hits from useInboxThreads({ filter: "everything", search }).
 *
 * Selecting a thread opens it. Selecting a command invokes the provided
 * handler — most commands require a current thread and are hidden when none
 * is selected. Pressing Escape or clicking outside closes.
 *
 * The palette registers its own Cmd+K listener so any page that mounts it
 * gets the shortcut for free (as long as focus isn't inside an input that
 * already handles Cmd+K itself).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Clock,
  Inbox,
  CheckCircle2,
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
  type InboxRail,
} from "@/lib/types/email-thread";
import { useInboxThreads } from "@/lib/hooks/use-inbox-threads";
import { categoryLabel } from "./category-chip";

// ─── Command definitions ─────────────────────────────────────────────────────

export interface CommandPaletteHandlers {
  onOpenThread: (threadId: string) => void;
  onSwitchRail: (rail: InboxRail) => void;
  onFilterCategory: (category: EmailThreadCategory | null) => void;
  onArchive?: () => void;
  onSnooze?: () => void;
  onRecategorizeOpen?: () => void;
  onMarkUnread?: () => void;
  onAIDraft?: () => void;
  onComposeNew: () => void;
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
    filter: "everything",
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
          "Search threads · run a command",
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
            <CommandGroup heading={t("commandPalette.heading.threads", "Threads")}>
              {searchHits.map((thread) => (
                <CommandItem
                  key={thread.id}
                  value={`thread:${thread.id} ${thread.subject} ${thread.latestSnippet ?? ""} ${thread.clientName ?? thread.latestSenderName ?? ""}`}
                  onSelect={() => run(() => handlers.onOpenThread(thread.id))}
                >
                  <Mail
                    className="w-[14px] h-[14px] text-text-3 shrink-0"
                    strokeWidth={1.5}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-mohave text-body-sm text-text truncate">
                      {thread.subject || t("detail.untitled", "(no subject)")}
                    </span>
                    <span className="font-mono text-[10px] text-text-mute uppercase tracking-[0.14em] truncate">
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
        {selectedThreadId && (
          <>
            <CommandGroup
              heading={t("commandPalette.heading.thisThread", "This thread")}
            >
              <CommandItem
                value="archive thread e"
                onSelect={() => run(handlers.onArchive)}
              >
                <Archive
                  className="w-[14px] h-[14px] text-text-3"
                  strokeWidth={1.5}
                />
                {t("commandPalette.cmd.archive", "Archive thread")}
                <span className="ml-auto">
                  <KeyHint keys="E" />
                </span>
              </CommandItem>
              <CommandItem
                value="snooze thread s"
                onSelect={() => run(handlers.onSnooze)}
              >
                <Clock
                  className="w-[14px] h-[14px] text-text-3"
                  strokeWidth={1.5}
                />
                {t("commandPalette.cmd.snooze", "Snooze thread")}
                <span className="ml-auto">
                  <KeyHint keys="S" />
                </span>
              </CommandItem>
              <CommandItem
                value="recategorize thread l"
                onSelect={() => run(handlers.onRecategorizeOpen)}
              >
                <Tag
                  className="w-[14px] h-[14px] text-text-3"
                  strokeWidth={1.5}
                />
                {t("commandPalette.cmd.recategorize", "Recategorize thread")}
                <span className="ml-auto">
                  <KeyHint keys="L" />
                </span>
              </CommandItem>
              <CommandItem
                value="mark unread u"
                onSelect={() => run(handlers.onMarkUnread)}
              >
                <Mail
                  className="w-[14px] h-[14px] text-text-3"
                  strokeWidth={1.5}
                />
                {t("commandPalette.cmd.markUnread", "Mark as unread")}
                <span className="ml-auto">
                  <KeyHint keys="U" />
                </span>
              </CommandItem>
              <CommandItem
                value="ai draft phase c"
                onSelect={() => run(handlers.onAIDraft)}
              >
                <Sparkles
                  className="w-[14px] h-[14px] text-text-3"
                  strokeWidth={1.5}
                />
                {t(
                  "commandPalette.cmd.aiDraft",
                  "Ask Phase C to draft a reply",
                )}
                <span className="ml-auto">
                  <KeyHint keys={["⇧", "D"]} />
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Navigation */}
        <CommandGroup
          heading={t("commandPalette.heading.navigate", "Navigate")}
        >
          <CommandItem
            value="needs reply 1"
            onSelect={() => run(() => handlers.onSwitchRail("needs_reply"))}
          >
            <Inbox
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.needsReply", "Go to Needs Reply")}
            <span className="ml-auto">
              <KeyHint keys="1" />
            </span>
          </CommandItem>
          <CommandItem
            value="everything 2"
            onSelect={() => run(() => handlers.onSwitchRail("everything"))}
          >
            <Inbox
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.everything", "Go to Everything")}
            <span className="ml-auto">
              <KeyHint keys="2" />
            </span>
          </CommandItem>
          <CommandItem
            value="scheduled 3"
            onSelect={() => run(() => handlers.onSwitchRail("scheduled"))}
          >
            <Clock
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.scheduled", "Go to Scheduled")}
            <span className="ml-auto">
              <KeyHint keys="3" />
            </span>
          </CommandItem>
          <CommandItem
            value="done 4"
            onSelect={() => run(() => handlers.onSwitchRail("done"))}
          >
            <CheckCircle2
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.done", "Go to Done")}
            <span className="ml-auto">
              <KeyHint keys="4" />
            </span>
          </CommandItem>
          <CommandItem
            value="all categories"
            onSelect={() => run(() => handlers.onFilterCategory(null))}
          >
            <Hash
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.nav.clearFilter", "Clear category filter")}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Category filters */}
        <CommandGroup
          heading={t("commandPalette.heading.filterCategory", "Filter category")}
        >
          {EMAIL_THREAD_CATEGORIES.map((cat) => (
            <CommandItem
              key={cat}
              value={`filter ${categoryLabel(cat)}`}
              onSelect={() => run(() => handlers.onFilterCategory(cat))}
            >
              <Hash
                className="w-[14px] h-[14px] text-text-3"
                strokeWidth={1.5}
              />
              {t("commandPalette.filter.only", "Only show {category}").replace(
                "{category}",
                categoryLabel(cat),
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Other */}
        <CommandGroup heading={t("commandPalette.heading.create", "Create")}>
          <CommandItem
            value="compose new email c"
            onSelect={() => run(handlers.onComposeNew)}
          >
            <Plus
              className="w-[14px] h-[14px] text-text-3"
              strokeWidth={1.5}
            />
            {t("commandPalette.cmd.composeNew", "Compose new email")}
            <span className="ml-auto">
              <KeyHint keys="C" />
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
