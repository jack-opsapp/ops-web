"use client";

/**
 * ConversationList (Inbox v2) — Fyxer/Superhuman-tier thread list.
 *
 * Reads `email_threads` via useInboxThreads infinite query. Each row shows:
 *   - CategoryChip (click → RecategorizeMenu)
 *   - sender avatar (initials) + name + subject + snippet
 *   - secondary label chips (URGENT / AWAITING_REPLY / HAS_ATTACHMENT, etc.)
 *   - right-side metadata: timestamp + unread dot + hover action icons
 *     (archive · snooze · more)
 *
 * Keyboard (when the list is focused):
 *   j / ↓      — next row
 *   k / ↑      — previous row
 *   Enter / →  — open selected thread
 *   e          — archive selected thread
 *   s          — open snooze picker for selected
 *   l          — open recategorize menu for selected
 *   u          — toggle mark read/unread
 *   #          — archive (destructive fallback; no delete on threads)
 *
 * The list automatically paginates via IntersectionObserver when the last
 * row scrolls into view. Search is instantaneous and driven by the parent.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Archive, Clock, Paperclip, FileSignature, Receipt, UserPlus, AlertTriangle, CornerUpLeft, Mail } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { motion, useReducedMotion } from "framer-motion";
import {
  useInboxThreads,
  useThreadActions,
  type InboxThreadRow,
  type UseInboxThreadsParams,
} from "@/lib/hooks/use-inbox-threads";
import type { EmailThreadCategory, EmailThreadLabel } from "@/lib/types/email-thread";
import { CategoryChip } from "./category-chip";
import { RecategorizeMenu } from "./recategorize-menu";
import { SnoozePicker } from "./snooze-picker";
import { enqueueUndoToast } from "./undo-toast";

// ─── Public props ────────────────────────────────────────────────────────────

export interface ConversationListProps {
  params: UseInboxThreadsParams;
  selectedThreadId: string | null;
  onSelectThread: (row: InboxThreadRow) => void;
  /** Fires when archive requires a write-back preference (first time). */
  onNeedsWritebackPreference: (connectionId: string, threadId: string) => void;
  /** True when parent wants the list to receive keyboard shortcuts. */
  keyboardActive?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "?";
  if (source.includes("@")) return source[0]?.toUpperCase() ?? "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso: string): string {
  const now = new Date();
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) {
    return then.toLocaleDateString(undefined, { weekday: "short" });
  }
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Label chip ──────────────────────────────────────────────────────────────

const LABEL_META: Record<EmailThreadLabel, { icon: React.ComponentType<React.ComponentProps<typeof AlertTriangle>>; label: string; tone: "warn" | "neutral" | "accent" }> = {
  URGENT:           { icon: AlertTriangle,  label: "Urgent",     tone: "warn" },
  AWAITING_REPLY:   { icon: CornerUpLeft,   label: "Reply due",  tone: "accent" },
  HAS_ATTACHMENT:   { icon: Paperclip,      label: "Attached",   tone: "neutral" },
  HAS_QUOTE:        { icon: FileSignature,  label: "Quote",      tone: "neutral" },
  HAS_INVOICE:      { icon: Receipt,        label: "Invoice",    tone: "neutral" },
  FROM_NEW_SENDER:  { icon: UserPlus,       label: "New",        tone: "neutral" },
};

function LabelChip({ label }: { label: EmailThreadLabel }) {
  const meta = LABEL_META[label];
  const Icon = meta.icon;
  const tone =
    meta.tone === "warn"
      ? "border-[rgba(164,88,79,0.32)] text-rose bg-[rgba(164,88,79,0.08)]"
      : meta.tone === "accent"
      ? "border-[rgba(111,148,176,0.30)] text-ops-accent bg-[rgba(111,148,176,0.08)]"
      : "border-border-subtle text-text-3 bg-[rgba(255,255,255,0.02)]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] h-[16px] px-[4px] rounded-[3px] border",
        "font-mono text-[10px] uppercase tracking-[0.14em] leading-none",
        tone
      )}
      title={meta.label}
    >
      <Icon className="w-[9px] h-[9px]" strokeWidth={2} />
      <span>{meta.label}</span>
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border-subtle animate-pulse">
      <div className="w-[30px] h-[30px] rounded-full bg-[rgba(255,255,255,0.04)] shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="h-[14px] w-[80px] rounded bg-[rgba(255,255,255,0.05)]" />
          <div className="h-[14px] w-[140px] rounded bg-[rgba(255,255,255,0.03)]" />
        </div>
        <div className="h-[12px] w-[90%] rounded bg-[rgba(255,255,255,0.03)]" />
      </div>
      <div className="h-[12px] w-[28px] rounded bg-[rgba(255,255,255,0.03)]" />
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface ThreadRowProps {
  thread: InboxThreadRow;
  isSelected: boolean;
  /** External trigger → open the recategorize menu on this row. */
  recatOpen: boolean;
  setRecatOpen: (open: boolean) => void;
  /** External trigger → open the snooze picker on this row. */
  snoozeOpen: boolean;
  setSnoozeOpen: (open: boolean) => void;
  onSelect: (thread: InboxThreadRow) => void;
  onArchive: (thread: InboxThreadRow) => void;
  onToggleRead: (thread: InboxThreadRow) => void;
}

function ThreadRow({
  thread,
  isSelected,
  recatOpen,
  setRecatOpen,
  snoozeOpen,
  setSnoozeOpen,
  onSelect,
  onArchive,
  onToggleRead,
}: ThreadRowProps) {
  const unread = thread.unreadCount > 0;
  const initials = getInitials(thread.latestSenderName, thread.latestSenderEmail);
  const timestamp = formatRelative(thread.lastMessageAt);

  // Show only the first 3 labels, plus "+N" if more.
  const labelsShown = thread.labels.slice(0, 3);
  const extraLabels = thread.labels.length - labelsShown.length;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-thread-id={thread.id}
      data-row-kind="thread"
      onClick={() => onSelect(thread)}
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer border-b border-border-subtle",
        "transition-colors duration-150",
        isSelected
          ? "bg-[rgba(255,255,255,0.05)]"
          : "hover:bg-[rgba(255,255,255,0.03)]"
      )}
    >
      {/* Left-edge accent for unread */}
      {unread && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px] bg-ops-accent"
        />
      )}

      {/* Avatar */}
      <div
        className={cn(
          "w-[30px] h-[30px] rounded-full shrink-0",
          "flex items-center justify-center",
          "border border-border-subtle",
          "bg-[rgba(255,255,255,0.04)]"
        )}
      >
        <span className="font-mono text-[11px] text-text-2 tracking-[0.06em] uppercase">
          {initials}
        </span>
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Line 1 — category chip + sender */}
        <div className="flex items-center gap-1.5 min-w-0">
          <RecategorizeMenu
            threadId={thread.id}
            currentCategory={thread.primaryCategory}
            open={recatOpen}
            onOpenChange={setRecatOpen}
            align="start"
            trigger={
              <span
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <CategoryChip
                  category={thread.primaryCategory}
                  size="sm"
                  interactive
                  manual={thread.categoryManuallySet}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRecatOpen(true);
                  }}
                />
              </span>
            }
          />
          <span
            className={cn(
              "font-mohave text-[13px] truncate",
              unread ? "text-text font-semibold" : "text-text-2"
            )}
          >
            {thread.latestSenderName || thread.latestSenderEmail || "Unknown"}
          </span>
          {thread.messageCount > 1 && (
            <span className="font-mono text-[10px] text-text-mute tabular-nums">
              {thread.messageCount}
            </span>
          )}
        </div>

        {/* Line 2 — subject */}
        <p
          className={cn(
            "mt-0.5 text-[12.5px] truncate",
            unread ? "text-text font-semibold font-mohave" : "text-text-2 font-mohave"
          )}
        >
          {thread.subject || "(no subject)"}
        </p>

        {/* Line 3 — snippet + labels */}
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <p className="font-mohave text-[11.5px] text-text-3 truncate flex-1 min-w-0">
            {thread.latestSnippet ?? ""}
          </p>
          {labelsShown.map((label) => (
            <LabelChip key={label} label={label} />
          ))}
          {extraLabels > 0 && (
            <span className="font-mono text-[10px] text-text-mute">
              +{extraLabels}
            </span>
          )}
        </div>
      </div>

      {/* Right column — time + actions */}
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-1">
          {unread && (
            <span
              aria-hidden
              className="w-[6px] h-[6px] rounded-full bg-ops-accent"
            />
          )}
          <span className="font-mono text-[10px] text-text-mute tabular-nums">
            {timestamp}
          </span>
        </div>

        {/* Hover action strip */}
        <div
          className={cn(
            "flex items-center gap-0.5",
            "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
            isSelected && "opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Archive"
            onClick={() => onArchive(thread)}
            className={cn(
              "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center",
              "border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-3",
              "hover:bg-[rgba(255,255,255,0.08)] hover:text-text transition-colors"
            )}
            title="Archive (E)"
          >
            <Archive className="w-[12px] h-[12px]" strokeWidth={1.75} />
          </button>

          <SnoozePicker
            threadId={thread.id}
            open={snoozeOpen}
            onOpenChange={setSnoozeOpen}
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Snooze"
                onClick={() => setSnoozeOpen(true)}
                className={cn(
                  "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center",
                  "border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-3",
                  "hover:bg-[rgba(255,255,255,0.08)] hover:text-text transition-colors"
                )}
                title="Snooze (S)"
              >
                <Clock className="w-[12px] h-[12px]" strokeWidth={1.75} />
              </button>
            }
          />

          <button
            type="button"
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            onClick={() => onToggleRead(thread)}
            className={cn(
              "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center",
              "border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-3",
              "hover:bg-[rgba(255,255,255,0.08)] hover:text-text transition-colors"
            )}
            title={unread ? "Mark as read (U)" : "Mark as unread (U)"}
          >
            <Mail className="w-[12px] h-[12px]" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

export function ConversationList({
  params,
  selectedThreadId,
  onSelectThread,
  onNeedsWritebackPreference,
  keyboardActive = true,
}: ConversationListProps) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [recatOpenId, setRecatOpenId] = useState<string | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, isError } =
    useInboxThreads(params);

  const threads = useMemo(
    () => data?.pages.flatMap((p) => p.threads) ?? [],
    [data]
  );

  // Auto-select first row if nothing selected yet.
  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      onSelectThread(threads[0]);
    }
  }, [selectedThreadId, threads, onSelectThread]);

  // Infinite loader sentinel.
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: listRef.current, rootMargin: "200px 0px 200px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Scroll selection into view when changed externally (e.g. j/k).
  useEffect(() => {
    if (!selectedThreadId) return;
    const el = rowRefs.current.get(selectedThreadId);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedThreadId]);

  const { archive, markRead } = useThreadActions();

  const handleArchive = useCallback(
    (thread: InboxThreadRow) => {
      archive.mutate(thread.id, {
        onSuccess: (res) => {
          if (res?.needsPreference && res.connectionId) {
            onNeedsWritebackPreference(res.connectionId, thread.id);
            return;
          }
          enqueueUndoToast({
            message: "Archived",
            detail: thread.subject,
            onUndo: () => archive.reset(),
          });
        },
        onError: (err) => {
          console.error("[inbox] archive failed", err);
        },
      });
    },
    [archive, onNeedsWritebackPreference]
  );

  const handleToggleRead = useCallback(
    (thread: InboxThreadRow) => {
      const nextIsRead = thread.unreadCount > 0;
      markRead.mutate({ threadId: thread.id, isRead: nextIsRead });
    },
    [markRead]
  );

  // Keyboard handler at list level.
  useEffect(() => {
    if (!keyboardActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (threads.length === 0) return;
      const currentIndex = Math.max(
        0,
        threads.findIndex((t) => t.id === selectedThreadId)
      );
      const current = threads[currentIndex];

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.min(currentIndex + 1, threads.length - 1);
          onSelectThread(threads[next]);
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          const prev = Math.max(currentIndex - 1, 0);
          onSelectThread(threads[prev]);
          break;
        }
        case "e":
        case "#": {
          if (!current) return;
          e.preventDefault();
          handleArchive(current);
          break;
        }
        case "s": {
          if (!current) return;
          e.preventDefault();
          setSnoozeOpenId(current.id);
          break;
        }
        case "l": {
          if (!current) return;
          e.preventDefault();
          setRecatOpenId(current.id);
          break;
        }
        case "u": {
          if (!current) return;
          e.preventDefault();
          handleToggleRead(current);
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    keyboardActive,
    threads,
    selectedThreadId,
    onSelectThread,
    handleArchive,
    handleToggleRead,
  ]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-hide">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-start justify-start px-4 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose">
          // Error
        </p>
        <p className="font-mohave text-[13px] text-text mt-1">
          Couldn&apos;t load your inbox.
        </p>
        <p className="font-mohave text-[12px] text-text-3 mt-0.5">
          Try again in a moment. If it keeps failing, sign out and back in.
        </p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-start justify-start px-4 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          // Inbox zero
        </p>
        <p className="font-mohave text-[13px] text-text mt-1">
          Nothing to triage here.
        </p>
        <p className="font-mohave text-[12px] text-text-3 mt-0.5">
          Switch rail to check snoozed or archived threads.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      ref={listRef}
      role="listbox"
      aria-label="Inbox threads"
      tabIndex={0}
      className="flex-1 overflow-y-auto scrollbar-hide focus:outline-none"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      {threads.map((thread) => (
        <div
          key={thread.id}
          ref={(node) => {
            if (node) rowRefs.current.set(thread.id, node);
            else rowRefs.current.delete(thread.id);
          }}
        >
          <ThreadRow
            thread={thread}
            isSelected={thread.id === selectedThreadId}
            recatOpen={recatOpenId === thread.id}
            setRecatOpen={(o) => setRecatOpenId(o ? thread.id : null)}
            snoozeOpen={snoozeOpenId === thread.id}
            setSnoozeOpen={(o) => setSnoozeOpenId(o ? thread.id : null)}
            onSelect={onSelectThread}
            onArchive={handleArchive}
            onToggleRead={handleToggleRead}
          />
        </div>
      ))}

      {/* Load more sentinel */}
      {hasNextPage && (
        <div ref={loadMoreRef} className="px-3 py-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            {isFetchingNextPage ? "Loading…" : ""}
          </p>
        </div>
      )}

      {!hasNextPage && threads.length > 10 && (
        <div className="px-3 py-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            End of list
          </p>
        </div>
      )}
    </motion.div>
  );
}
