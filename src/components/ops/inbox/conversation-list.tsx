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
import { Archive, Clock, Paperclip, FileSignature, Receipt, UserPlus, AlertTriangle, CornerUpLeft, Mail, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { motion, useReducedMotion } from "framer-motion";
import {
  useInboxThreads,
  useThreadActions,
  type InboxDraftRow,
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
  /**
   * Drafts indexed by provider thread id. When a thread has an entry here,
   * the row paints a small [DRAFT] pill on the snippet line. Passing null
   * (vs. an empty object) means "drafts haven't loaded yet" so we skip the
   * pill rather than implying "no drafts exist".
   */
  draftsByThreadId?: Record<string, InboxDraftRow> | null;
  /**
   * When true, the list renders `drafts` instead of threads and ignores
   * `params`. `onOpenDraft` is invoked on click (thread-bound drafts open
   * the thread; the parent decides whether to also pop compose). `onDiscardDraft`
   * wires the trash icon. Used by the DRAFTS rail.
   */
  draftMode?: boolean;
  drafts?: InboxDraftRow[];
  onOpenDraft?: (draft: InboxDraftRow) => void;
  onDiscardDraft?: (draft: InboxDraftRow) => void;
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

/**
 * Small amber-accent pill shown on a thread row when the user has an
 * unsent draft on that thread (Gmail/Outlook reply in progress OR an OPS
 * AI draft). Intentionally distinct from LabelChip's tone palette so it
 * reads as "action pending from you" rather than metadata.
 */
function DraftPill({ source }: { source: "provider" | "ai" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] h-[16px] px-[4px] rounded-[3px] border",
        "font-mono text-[10px] uppercase tracking-[0.14em] leading-none",
        // Amber-ish tone drawn from the design-system status palette
        // (C4A868-adjacent). Readable over the row hover without being
        // louder than the unread accent strip.
        "border-[rgba(196,168,104,0.32)] text-[#C4A868] bg-[rgba(196,168,104,0.08)]"
      )}
      title={source === "ai" ? "AI draft pending review" : "Draft in Gmail/Outlook"}
    >
      <Pencil className="w-[9px] h-[9px]" strokeWidth={2} />
      <span>Draft</span>
    </span>
  );
}

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
  /** When present, paints the Draft pill on this thread's row. */
  draft?: InboxDraftRow | null;
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
  draft,
}: ThreadRowProps) {
  const unread = thread.unreadCount > 0;
  // Display name priority: canonical client name → sender display name →
  // sender email → "Unknown". The client name is the identity of the
  // conversation (who are you corresponding with); the sender is whoever
  // happened to send last, which is often the user themselves on outbound
  // replies and confuses the list card.
  const displayName =
    thread.clientName ||
    thread.latestSenderName ||
    thread.latestSenderEmail ||
    "Unknown";
  const initials = getInitials(displayName, thread.latestSenderEmail);
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
            {displayName}
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
          {draft && <DraftPill source={draft.source} />}
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

// ─── Draft row (used in DRAFTS rail) ─────────────────────────────────────────
//
// Thinner than a thread row — no category chip, no unread state, no avatar
// flourish. The goal here is "pick a draft to continue", not "triage an
// incoming thread", so we optimize for subject + snippet of the draft body
// and a conspicuous trash affordance.

interface DraftRowProps {
  draft: InboxDraftRow;
  isSelected: boolean;
  onOpen: (draft: InboxDraftRow) => void;
  onDiscard: (draft: InboxDraftRow) => void;
}

function DraftRow({ draft, isSelected, onOpen, onDiscard }: DraftRowProps) {
  // Body preview — collapse whitespace, truncate to a single line.
  const bodyPreview = (draft.bodyText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const recipient = draft.to[0] || "(no recipient)";
  const timestamp = formatRelative(draft.updatedAt);

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-draft-id={draft.id}
      data-row-kind="draft"
      onClick={() => onOpen(draft)}
      className={cn(
        "group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer border-b border-border-subtle",
        "transition-colors duration-150",
        isSelected
          ? "bg-[rgba(255,255,255,0.05)]"
          : "hover:bg-[rgba(255,255,255,0.03)]"
      )}
    >
      {/* Draft icon sits where the avatar would — same footprint so the
          two row kinds align visually when switching rails. */}
      <div
        className={cn(
          "w-[30px] h-[30px] rounded-full shrink-0",
          "flex items-center justify-center border",
          "border-[rgba(196,168,104,0.24)] bg-[rgba(196,168,104,0.06)]"
        )}
      >
        <Pencil className="w-[12px] h-[12px] text-[#C4A868]" strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <DraftPill source={draft.source} />
          <span className="font-mohave text-[13px] text-text truncate">
            To {recipient}
          </span>
        </div>
        <p className="mt-0.5 font-mohave text-[12.5px] text-text-2 truncate">
          {draft.subject || "(no subject)"}
        </p>
        <p className="mt-0.5 font-mohave text-[11.5px] text-text-3 truncate">
          {bodyPreview || "(empty draft)"}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="font-mono text-[10px] text-text-mute tabular-nums">
          {timestamp}
        </span>
        <button
          type="button"
          aria-label="Discard draft"
          onClick={(e) => {
            e.stopPropagation();
            onDiscard(draft);
          }}
          className={cn(
            "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center",
            "border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-3",
            "hover:bg-[rgba(164,88,79,0.12)] hover:border-[rgba(164,88,79,0.32)] hover:text-rose transition-colors",
            // Always visible in the drafts rail — unlike thread rows where
            // actions only show on hover — because discard IS the point.
          )}
          title="Discard draft"
        >
          <Trash2 className="w-[12px] h-[12px]" strokeWidth={1.75} />
        </button>
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
  draftsByThreadId = null,
  draftMode = false,
  drafts = [],
  onOpenDraft,
  onDiscardDraft,
}: ConversationListProps) {
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [recatOpenId, setRecatOpenId] = useState<string | null>(null);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Thread query is enabled only when we're NOT in draft mode. Wasting a
  // threads fetch while the user browses drafts would re-populate the cache
  // and cause flicker when they switch rails back.
  const threadsQuery = useInboxThreads(params);
  const data = draftMode ? undefined : threadsQuery.data;
  const isLoading = draftMode ? false : threadsQuery.isLoading;
  const isError = draftMode ? false : threadsQuery.isError;
  const isFetchingNextPage = draftMode ? false : threadsQuery.isFetchingNextPage;
  const hasNextPage = draftMode ? false : threadsQuery.hasNextPage;
  const fetchNextPage = threadsQuery.fetchNextPage;

  const threads = useMemo(
    () => data?.pages.flatMap((p) => p.threads) ?? [],
    [data]
  );

  // Auto-select first row if nothing selected yet. Disabled in draft mode
  // (we don't want to hijack thread selection when the user is browsing
  // drafts — parent owns that contract).
  useEffect(() => {
    if (draftMode) return;
    if (!selectedThreadId && threads.length > 0) {
      onSelectThread(threads[0]);
    }
  }, [draftMode, selectedThreadId, threads, onSelectThread]);

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

  // Keyboard handler at list level. In draft mode we let the browser handle
  // arrow keys normally — the drafts rail doesn't need archive/snooze/etc.
  // and j/k would be confusing without a matching detail pane.
  useEffect(() => {
    if (!keyboardActive || draftMode) return;
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
    draftMode,
    threads,
    selectedThreadId,
    onSelectThread,
    handleArchive,
    handleToggleRead,
  ]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // Draft mode short-circuits the threads list entirely — the rail is a
  // flat, keyboard-lite list of drafts (thread-bound or standalone). Empty
  // state copy is distinct from "inbox zero" so the user understands the
  // absence is about drafts, not unread mail.
  if (draftMode) {
    if (drafts.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-start justify-start px-4 py-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
            // No drafts
          </p>
          <p className="font-mohave text-[13px] text-text mt-1">
            Nothing in progress.
          </p>
          <p className="font-mohave text-[12px] text-text-3 mt-0.5">
            Drafts started in Gmail/Outlook show up here too.
          </p>
        </div>
      );
    }
    return (
      <motion.div
        ref={listRef}
        role="listbox"
        aria-label="Drafts"
        tabIndex={0}
        className="flex-1 overflow-y-auto scrollbar-hide focus:outline-none"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: EASE_SMOOTH }}
      >
        {drafts.map((d) => (
          <DraftRow
            key={`${d.source}:${d.id}`}
            draft={d}
            isSelected={selectedDraftId === d.id}
            onOpen={(draft) => {
              setSelectedDraftId(draft.id);
              onOpenDraft?.(draft);
            }}
            onDiscard={(draft) => onDiscardDraft?.(draft)}
          />
        ))}
      </motion.div>
    );
  }

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
            draft={
              // The drafts map keys on provider thread id (Gmail threadId /
              // M365 conversationId), which is `thread.providerThreadId`
              // on the list row. When no draft matches, pass undefined —
              // the pill simply won't render.
              draftsByThreadId?.[thread.providerThreadId] ?? null
            }
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
