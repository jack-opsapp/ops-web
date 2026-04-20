"use client";

/**
 * ThreadDetailView (Inbox v2) — the center pane of the rebuilt inbox.
 *
 * Reads `email_threads` + provider messages via useInboxThread. Renders:
 *   - Header: subject + CategoryChip (interactive → RecategorizeMenu) +
 *     message count + context-panel toggle
 *   - PhaseCStatusStrip (sliver)
 *   - AI summary (rendered when ai_summary is present OR messageCount ≥ 10)
 *   - Message stack (inbound left bubble, outbound right bubble, date grouping)
 *   - Persistent action bar: Archive · Snooze · Recategorize · Mark unread ·
 *     AI draft · Reply · Schedule send
 *
 * Keyboard shortcuts are scoped to this pane when keyboardActive is true:
 *   e archive · s snooze · l recategorize · u toggle read/unread ·
 *   r reply · Shift+D ask AI · c compose new · Esc back to list
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Clock,
  Tag,
  Mail,
  Sparkles,
  Reply,
  Send,
  PanelRight,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import {
  useInboxThread,
  useThreadActions,
  type InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import type {
  EmailThreadAutonomyLevel,
  EmailThreadCategory,
} from "@/lib/types/email-thread";
import type { ComposeEmailData } from "@/lib/types/email-template";
import { CategoryChip, categoryLabel } from "./category-chip";
import { RecategorizeMenu } from "./recategorize-menu";
import { SnoozePicker } from "./snooze-picker";
import { enqueueUndoToast } from "./undo-toast";
import {
  PhaseCStatusStrip,
  computePhaseCStripState,
  type PhaseCStripState,
} from "./phase-c-status-strip";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ThreadDetailViewProps {
  /** The row from the list (used for instant-paint before detail loads). */
  listRow: InboxThreadRow | null;
  /** The v2 thread detail query — separately fetched. */
  threadId: string | null;
  /** Fires when archive requires a write-back preference (first time). */
  onNeedsWritebackPreference: (connectionId: string, threadId: string) => void;
  /** Parent opens the compose modal with this data. */
  onReply: (data: ComposeEmailData) => void;
  /** Parent opens the compose modal for a brand-new email. */
  onComposeNew: () => void;
  /** Parent toggles the right context panel. */
  onToggleContext: () => void;
  contextOpen: boolean;
  /** Autonomy + runtime flags for PhaseCStatusStrip (optional). */
  autonomyLevel?: EmailThreadAutonomyLevel;
  hasPendingAutoDraft?: boolean;
  hasAutoSent?: boolean;
  /** True when this pane should receive keyboard shortcuts. */
  keyboardActive?: boolean;
  /** Permission gate for Phase C settings link in the status strip. */
  canConfigurePhaseC?: boolean;
  /** Escape goes back to list on narrow layouts. */
  onBack?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string | null, email: string): string {
  const source = name?.trim() || email.trim() || "?";
  if (source.includes("@")) return source[0]?.toUpperCase() ?? "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Message bubble ──────────────────────────────────────────────────────────

interface BubbleProps {
  from: string;
  fromName: string | null;
  /** Full raw body including quoted reply chain. Shown when expanded. */
  bodyText: string;
  /** Body with quoted reply chain stripped. Default visible content. */
  cleanBodyText: string;
  snippet: string;
  date: Date;
  hasAttachments: boolean;
  isOutbound: boolean;
  isRead: boolean;
}

function MessageBubble({
  from,
  fromName,
  bodyText,
  cleanBodyText,
  snippet,
  date,
  hasAttachments,
  isOutbound,
  isRead,
}: BubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const initials = getInitials(fromName, from);
  // `from` may arrive as "Display Name <email@domain>" from the provider.
  // Strip the angle-bracket address so the header never shows raw email when
  // a nice display name is available.
  const displayName = fromName ?? from.replace(/\s*<[^>]+>\s*$/, "").trim();
  const display = displayName || from;

  // If stripQuotedContent actually removed something, we have a collapsed
  // view to show — otherwise the "Show quoted" affordance would be dead.
  const hasQuoted =
    cleanBodyText.length > 0 &&
    bodyText.length > cleanBodyText.length + 10;
  const visibleBody =
    (expanded ? bodyText : cleanBodyText) || snippet || bodyText;

  return (
    <div
      className={cn(
        "flex items-start gap-2",
        isOutbound ? "justify-end" : "justify-start"
      )}
    >
      {!isOutbound && (
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full shrink-0 mt-[2px]",
            "flex items-center justify-center border border-border-subtle",
            "bg-[rgba(255,255,255,0.04)]"
          )}
        >
          <span className="font-mono text-[10px] text-text-2 uppercase">
            {initials}
          </span>
        </div>
      )}

      <div
        className={cn(
          "max-w-[78%] min-w-0 flex flex-col",
          isOutbound ? "items-end" : "items-start"
        )}
      >
        {/* Sender row */}
        <div className="flex items-center gap-1.5 mb-[3px]">
          <span
            className={cn(
              "font-mohave text-[12px] truncate",
              isRead ? "text-text-2" : "text-text font-semibold"
            )}
          >
            {display}
          </span>
          <span className="font-mono text-[10px] text-text-mute tabular-nums">
            {formatTime(date)}
          </span>
          {hasAttachments && (
            <Paperclip className="w-[10px] h-[10px] text-text-mute" strokeWidth={2} />
          )}
        </div>

        {/* Body */}
        <div
          className={cn(
            "rounded-[6px] px-3 py-2 border",
            isOutbound
              ? "bg-[rgba(111,148,176,0.10)] border-[rgba(111,148,176,0.24)]"
              : "bg-[rgba(255,255,255,0.03)] border-border-subtle"
          )}
        >
          <p className="font-mohave text-[13px] text-text whitespace-pre-wrap break-words leading-relaxed">
            {visibleBody}
          </p>

          {hasQuoted && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                "mt-2 inline-flex items-center gap-1 px-1.5 h-[20px] rounded-[3px]",
                "font-mono text-[10px] uppercase tracking-[0.12em]",
                "text-text-mute hover:text-text-2 transition-colors",
                "border border-border-subtle hover:border-[rgba(255,255,255,0.14)]",
                "bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.05)]"
              )}
              aria-expanded={expanded}
            >
              {expanded ? "Hide quoted" : "Show quoted"}
            </button>
          )}
        </div>
      </div>

      {isOutbound && (
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-full shrink-0 mt-[2px]",
            "flex items-center justify-center border border-[rgba(111,148,176,0.24)]",
            "bg-[rgba(111,148,176,0.10)]"
          )}
        >
          <span className="font-mono text-[10px] text-ops-accent uppercase">
            {initials}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Action bar ──────────────────────────────────────────────────────────────

interface ActionButtonProps {
  icon: React.ComponentType<React.ComponentProps<typeof Archive>>;
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "primary";
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
  active,
  tone = "default",
}: ActionButtonProps) {
  const base =
    "inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border transition-colors duration-150";
  const styles =
    tone === "primary"
      ? "border-[rgba(111,148,176,0.30)] bg-[rgba(111,148,176,0.10)] text-text hover:bg-[rgba(111,148,176,0.14)]"
      : active
      ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
      : "border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} (${hint})` : label}
      className={cn(base, styles, disabled && "opacity-40 cursor-not-allowed")}
    >
      <Icon className="w-[13px] h-[13px]" strokeWidth={1.75} />
      <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em]">
        {label}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-text-mute ml-0.5">{hint}</span>
      )}
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ThreadDetailView({
  listRow,
  threadId,
  onNeedsWritebackPreference,
  onReply,
  onComposeNew,
  onToggleContext,
  contextOpen,
  autonomyLevel,
  hasPendingAutoDraft = false,
  hasAutoSent = false,
  keyboardActive = true,
  canConfigurePhaseC = false,
  onBack,
}: ThreadDetailViewProps) {
  const { t } = useDictionary("inbox");
  const reduceMotion = useReducedMotion();
  const { data, isLoading } = useInboxThread(threadId);
  const { archive, unarchive, markRead } = useThreadActions();

  const [recatOpen, setRecatOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);

  // Prefer detail over listRow when available (detail is authoritative).
  const thread = data?.thread;
  const messages = data?.messages ?? [];

  const category: EmailThreadCategory | null =
    thread?.primaryCategory ?? listRow?.primaryCategory ?? null;
  const subject = thread?.subject ?? listRow?.subject ?? "";
  const messageCount = thread?.messageCount ?? listRow?.messageCount ?? 0;
  const unreadCount = thread?.unreadCount ?? listRow?.unreadCount ?? 0;
  const aiSummary = thread?.aiSummary ?? listRow?.aiSummary ?? null;
  const archivedAt = thread?.archivedAt ?? listRow?.archivedAt ?? null;
  const manuallySet =
    thread?.categoryManuallySet ?? listRow?.categoryManuallySet ?? false;
  const participants =
    thread?.participants ?? listRow?.participants ?? [];
  const isArchived = archivedAt !== null;

  const phaseCState: PhaseCStripState = useMemo(() => {
    if (!category) return "hidden";
    return computePhaseCStripState({
      autonomyLevel,
      hasAutoDraft: hasPendingAutoDraft,
      hasAutoSent,
    });
  }, [category, autonomyLevel, hasPendingAutoDraft, hasAutoSent]);

  // Mark thread read when opened (once per threadId).
  useEffect(() => {
    if (!threadId || !thread || unreadCount === 0) return;
    markRead.mutate({ threadId, isRead: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // ─── Handlers ─────────────────────────────────────────────────────────

  const handleArchive = useCallback(() => {
    if (!threadId) return;
    if (isArchived) {
      unarchive.mutate(threadId, {
        onSuccess: () => {
          enqueueUndoToast({
            message: "Moved back to inbox",
            onUndo: () => archive.mutate(threadId),
          });
        },
      });
      return;
    }
    archive.mutate(threadId, {
      onSuccess: (res) => {
        if (res?.needsPreference && res.connectionId) {
          onNeedsWritebackPreference(res.connectionId, threadId);
          return;
        }
        enqueueUndoToast({
          message: "Archived",
          detail: subject,
          onUndo: () => unarchive.mutate(threadId),
        });
      },
    });
  }, [threadId, isArchived, archive, unarchive, onNeedsWritebackPreference, subject]);

  const handleMarkUnread = useCallback(() => {
    if (!threadId) return;
    const next = unreadCount === 0; // if currently read, mark unread
    markRead.mutate({ threadId, isRead: !next });
  }, [threadId, unreadCount, markRead]);

  const handleReply = useCallback(() => {
    if (!threadId) return;
    const lastInbound = [...messages].reverse().find((m) => !!m.from);
    if (!lastInbound) return;
    onReply({
      mode: "reply",
      to: lastInbound.from,
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      quotedMessage: lastInbound.bodyText?.slice(0, 2000) ?? "",
      threadId: listRow?.providerThreadId,
      inReplyTo: lastInbound.id,
    });
  }, [threadId, messages, onReply, subject, listRow?.providerThreadId]);

  const handleAIDraft = useCallback(() => {
    // Phase C's draft surface lives in the compose modal — pass a flag.
    if (!threadId) return;
    const lastInbound = [...messages].reverse().find((m) => !!m.from);
    onReply({
      mode: "reply",
      to: lastInbound?.from ?? "",
      subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
      quotedMessage: lastInbound?.bodyText?.slice(0, 2000) ?? "",
      threadId: listRow?.providerThreadId,
      inReplyTo: lastInbound?.id,
      // `aiDraft` opens the Phase C draft generator automatically.
      aiDraft: true,
    });
  }, [threadId, messages, onReply, subject, listRow?.providerThreadId]);

  // Keyboard — scoped to this pane.
  useEffect(() => {
    if (!keyboardActive || !threadId) return;
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

      switch (e.key) {
        case "e":
          e.preventDefault();
          handleArchive();
          break;
        case "s":
          e.preventDefault();
          setSnoozeOpen(true);
          break;
        case "l":
          e.preventDefault();
          setRecatOpen(true);
          break;
        case "u":
          e.preventDefault();
          handleMarkUnread();
          break;
        case "r":
          e.preventDefault();
          handleReply();
          break;
        case "D":
          if (e.shiftKey) {
            e.preventDefault();
            handleAIDraft();
          }
          break;
        case "c":
          e.preventDefault();
          onComposeNew();
          break;
        case "Escape":
          if (onBack) {
            e.preventDefault();
            onBack();
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    keyboardActive,
    threadId,
    handleArchive,
    handleMarkUnread,
    handleReply,
    handleAIDraft,
    onComposeNew,
    onBack,
  ]);

  // ─── Derived render data ──────────────────────────────────────────────
  //
  // MUST come before the `!threadId` early return below. React hook rules
  // require the same hooks to be called on every render; if this useMemo
  // sits after the early-return it gets skipped when threadId is null and
  // re-runs once a user picks a thread, tripping "Rendered more hooks than
  // during the previous render" and crashing the thread pane.
  const messagesWithDates = useMemo(() => {
    let lastLabel = "";
    return messages.map((m) => {
      const d = new Date(m.date);
      const label = formatDateGroup(d);
      const showLabel = label !== lastLabel;
      lastLabel = label;
      return { ...m, dateObj: d, dateLabel: label, showLabel };
    });
  }, [messages]);

  // ─── Empty state ──────────────────────────────────────────────────────

  if (!threadId) {
    return (
      <div className="flex flex-col items-start justify-start h-full px-6 py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
          // Nothing selected
        </p>
        <p className="font-mohave text-[13px] text-text mt-1">
          Pick a thread from the list.
        </p>
        <p className="font-mohave text-[12px] text-text-3 mt-0.5">
          Or hit <span className="font-mono text-[11px] text-text-2">⌘K</span> to
          search or jump.
        </p>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <motion.div
      className="flex flex-col h-full min-h-0"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: EASE_SMOOTH }}
    >
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border-subtle">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {category && (
                <RecategorizeMenu
                  threadId={threadId}
                  currentCategory={category}
                  open={recatOpen}
                  onOpenChange={setRecatOpen}
                  align="start"
                  trigger={
                    <CategoryChip
                      category={category}
                      size="md"
                      interactive
                      manual={manuallySet}
                      onClick={() => setRecatOpen(true)}
                    />
                  }
                />
              )}
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                // {participants.length} {participants.length === 1 ? "person" : "people"}
                {messageCount > 0 && ` · ${messageCount} msg${messageCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <h1 className="font-cakemono font-light uppercase text-[18px] tracking-[0.08em] text-text mt-1 truncate">
              {subject || "(no subject)"}
            </h1>
          </div>

          <button
            type="button"
            onClick={onToggleContext}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-2.5 h-[28px] rounded-[5px] border transition-colors duration-150",
              contextOpen
                ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                : "border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text"
            )}
          >
            <PanelRight className="w-[12px] h-[12px]" strokeWidth={1.75} />
            <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em]">
              {t("context.toggle") ?? "Context"}
            </span>
          </button>
        </div>
      </div>

      {/* ─── Phase C status strip ──────────────────────────────────────── */}
      {category && (
        <PhaseCStatusStrip
          state={phaseCState}
          category={category}
          autonomyLevel={autonomyLevel}
          onReviewDraft={handleAIDraft}
          canConfigure={canConfigurePhaseC}
        />
      )}

      {/* ─── AI summary ────────────────────────────────────────────────── */}
      {(aiSummary || messageCount >= 10) && aiSummary && (
        <div className="shrink-0 px-3 py-2 border-b border-border-subtle bg-[rgba(111,148,176,0.04)]">
          <div className="flex items-start gap-2">
            <Sparkles className="w-[12px] h-[12px] text-ops-accent shrink-0 mt-[3px]" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
                // {t("thread.aiSummary") ?? "AI summary"}
              </p>
              <p
                className={cn(
                  "font-mohave text-[12.5px] text-text-2 mt-0.5 leading-snug",
                  !showFullSummary && "line-clamp-2"
                )}
              >
                {aiSummary}
              </p>
              {aiSummary.length > 200 && (
                <button
                  type="button"
                  onClick={() => setShowFullSummary((v) => !v)}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-mute hover:text-text-2 mt-1 transition-colors"
                >
                  {showFullSummary ? "Collapse" : "Expand"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Messages ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 py-3 space-y-3">
        {isLoading && (
          <div className="space-y-3">
            <div className="h-[62px] rounded-[6px] bg-[rgba(255,255,255,0.03)] animate-pulse" />
            <div className="h-[62px] rounded-[6px] bg-[rgba(255,255,255,0.03)] animate-pulse" />
          </div>
        )}

        {!isLoading &&
          messagesWithDates.map((m) => {
            // Trust the server-derived direction. It was computed against the
            // owning connection's email, so it's correct even when the stored
            // activities.direction is unreliable (imported data era).
            const isOutbound = m.direction === "outbound";
            return (
              <div key={m.id}>
                {m.showLabel && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="h-[1px] flex-1 bg-border-subtle" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
                      {m.dateLabel}
                    </span>
                    <div className="h-[1px] flex-1 bg-border-subtle" />
                  </div>
                )}
                <MessageBubble
                  from={m.from}
                  fromName={m.fromName}
                  bodyText={m.bodyText}
                  cleanBodyText={m.cleanBodyText}
                  snippet={m.snippet}
                  date={m.dateObj}
                  hasAttachments={m.hasAttachments}
                  isOutbound={isOutbound}
                  isRead={m.isRead}
                />
              </div>
            );
          })}

        {!isLoading && messagesWithDates.length === 0 && (
          <div className="flex flex-col items-start justify-start py-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute">
              // Empty thread
            </p>
            <p className="font-mohave text-[13px] text-text mt-1">
              No messages to show.
            </p>
          </div>
        )}
      </div>

      {/* ─── Action bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2 border-t border-border-subtle bg-[rgba(255,255,255,0.02)]">
        <div className="flex items-center gap-1 flex-wrap">
          <ActionButton
            icon={Reply}
            label="Reply"
            hint="R"
            onClick={handleReply}
            tone="primary"
            disabled={isArchived}
          />
          <ActionButton
            icon={Sparkles}
            label="AI draft"
            hint="⇧D"
            onClick={handleAIDraft}
            disabled={isArchived}
          />
          <div className="w-[1px] h-[18px] bg-border-subtle mx-1" aria-hidden />
          <ActionButton
            icon={Archive}
            label={isArchived ? "Unarchive" : "Archive"}
            hint="E"
            onClick={handleArchive}
          />
          <SnoozePicker
            threadId={threadId}
            open={snoozeOpen}
            onOpenChange={setSnoozeOpen}
            align="end"
            trigger={
              <button
                type="button"
                onClick={() => setSnoozeOpen(true)}
                className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text transition-colors duration-150"
              >
                <Clock className="w-[13px] h-[13px]" strokeWidth={1.75} />
                <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em]">
                  Snooze
                </span>
                <span className="font-mono text-[10px] text-text-mute ml-0.5">S</span>
              </button>
            }
          />
          {category && (
            <ActionButton
              icon={Tag}
              label="Recategorize"
              hint="L"
              onClick={() => setRecatOpen(true)}
            />
          )}
          <ActionButton
            icon={Mail}
            label={unreadCount > 0 ? "Mark read" : "Mark unread"}
            hint="U"
            onClick={handleMarkUnread}
          />
          <div className="flex-1" />
          <button
            type="button"
            onClick={onComposeNew}
            className="inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-[5px] border border-border-subtle bg-[rgba(255,255,255,0.03)] text-text-2 hover:bg-[rgba(255,255,255,0.06)] hover:text-text transition-colors duration-150"
            title="Compose new (C)"
          >
            <Send className="w-[13px] h-[13px]" strokeWidth={1.75} />
            <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.14em]">
              Compose
            </span>
            <span className="font-mono text-[10px] text-text-mute ml-0.5">C</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Re-export a minimal helper for page-level invalidation on thread change.
export function useThreadCategoryLabel(category: EmailThreadCategory | null) {
  return useMemo(() => {
    return category ? categoryLabel(category) : null;
  }, [category]);
}
