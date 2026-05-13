"use client";

/**
 * ThreadRow — Phase B2 brand-intent rebuild.
 *
 * Anatomy (top-down):
 *   • alarm strip (only when state.alarmStrip === true) — rose `// {N}D · UNANSWERED`
 *   • title row: client name + optional `· {messageCount}` + inline <StateTag>
 *     + relative time (only when StateTag doesn't already carry a time value)
 *   • subject line (font-weight tracks unread/read)
 *   • snippet line — body is `aiSummary ?? snippet`, with optional `// CLAUDE DRAFT ·` (AI)
 *     or `DRAFT ·` (operator) Cake-prefix
 *   • bottom signal row — only when at least one of attachment / quote / invoice / new-sender
 *     is present. The legacy URGENT pill is gone — the inline <StateTag> now carries urgency.
 *
 * Stripe color is derived from `state.kind`, NOT the legacy URGENT label:
 *   selected → accent · alarmed/overdue → rose · ai-drafted → lavender · else → transparent
 *
 * Overdue/alarmed rows tint the entire row body rose (`bg-rose/[0.04]` → `bg-rose/[0.08]` on
 * hover) so they read as urgent even at a glance, not just at the stripe.
 */

import { useId, type MouseEvent } from "react";
import {
  DollarSign,
  Paperclip,
  Receipt,
  UserPlus,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ThreadForGrouping } from "@/lib/inbox/grouping";
import type { StateTagResult } from "@/lib/inbox/format-wait";
import { StateTag } from "./state-tag";
import {
  inboxThreadHref,
  shouldHandleInPlaceThreadNavigation,
} from "./inbox-navigation";

export interface ThreadRowData extends ThreadForGrouping {
  clientName: string;
  subject: string;
  /** Raw provider snippet — the fallback when AI summary isn't available. */
  snippet: string;
  /** Server-side AI summary; renders in preference to `snippet` when present. */
  aiSummary: string | null;
  /** Total messages in the thread. Renders inline as `· {n}` when > 1. */
  messageCount: number;
  /** Pre-computed state-tag result — drives the inline tag, the row stripe, and the alarm strip. */
  state: StateTagResult;
  /**
   * Unix ms of the most recent inbound message — used to compute the alarm strip's day count.
   * Null when latest direction is outbound or unknown.
   */
  lastInboundAt: number | null;
}

interface ThreadRowProps {
  thread: ThreadRowData;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  /**
   * When provided AND state.kind === "yours", the StateTag reveals a hover-X
   * that clears AWAITING_REPLY on the thread (see `useThreadActions.dismissAwaitingReply`).
   * Omit on rails where the override doesn't make sense (e.g. archived list).
   */
  onDismissAwaitingReply?: (threadId: string) => void;
}

function formatRelativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * State kinds whose StateTag already carries the time information (e.g.
 * `YOURS · 34M`, `THEIRS · 2H`, `+8D · WAITING`). For these the trailing
 * relative-time stamp is suppressed — without this guard the row reads
 * `Office Victoria · YOURS · 34M · 34m`, with two near-identical clocks.
 *
 * `fyi`, `closed`, `draft_ready`, `auto_sent`, `sys` carry no time, so the
 * trailing relative time still renders for those.
 */
const STATE_OWNS_TIME = new Set<StateTagResult["kind"]>([
  "yours",
  "theirs",
  "overdue",
  "alarmed",
]);

export function ThreadRow({
  thread,
  selected,
  now,
  onSelect,
  onDismissAwaitingReply,
}: ThreadRowProps) {
  const { t } = useDictionary("inbox");
  const isAiDraft =
    thread.phaseC === "ai_drafted" || thread.draftKind === "ai";
  const hasUserDraft = thread.draftKind === "user";
  const isUnread = thread.unread;
  const isOverdue =
    thread.state.kind === "alarmed" || thread.state.kind === "overdue";

  const showSignalRow =
    thread.labels.includes("HAS_ATTACHMENT") ||
    thread.labels.includes("HAS_QUOTE") ||
    thread.labels.includes("HAS_INVOICE") ||
    thread.labels.includes("FROM_NEW_SENDER");

  const stripeColor = selected
    ? "bg-ops-accent"
    : isOverdue
      ? "bg-rose"
      : isAiDraft
        ? "bg-agent"
        : "bg-transparent";

  const alarmDays =
    thread.state.alarmStrip && thread.lastInboundAt !== null
      ? Math.floor((now - thread.lastInboundAt) / 86_400_000)
      : 0;

  const showTrailingTime = !STATE_OWNS_TIME.has(thread.state.kind);
  const clientNameId = useId();
  const subjectId = useId();
  const href = inboxThreadHref(thread.id);

  const handleSelect = (e: MouseEvent<HTMLAnchorElement>) => {
    if (shouldHandleInPlaceThreadNavigation(e)) {
      e.preventDefault();
      onSelect(thread.id);
    }
  };

  const tagDismiss =
    onDismissAwaitingReply && thread.state.kind === "yours"
      ? () => onDismissAwaitingReply(thread.id)
      : undefined;

  return (
    <div
      className={cn(
        "group relative block w-full cursor-pointer border-b border-line text-left",
        "py-2.5 pl-2 pr-3.5",
        selected
          ? "bg-ops-accent/[0.07]"
          : isOverdue
            ? "bg-rose/[0.04] hover:bg-rose/[0.08]"
            : "hover:bg-inbox-elev/40",
      )}
    >
      <a
        href={href}
        onClick={handleSelect}
        aria-current={selected ? "page" : undefined}
        aria-labelledby={`${clientNameId} ${subjectId}`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      />
      <span
        data-testid="thread-row-stripe"
        aria-hidden
        className={cn(
          "absolute left-0 top-2 bottom-2 rounded-r-[2px]",
          stripeColor,
          selected ? "w-[3px]" : "w-[2px]",
          isUnread ? "opacity-90" : "opacity-50",
        )}
      />

      <div className="relative z-20 pointer-events-none">
        {/* Alarm strip — rose, only on alarmed (>14d unanswered) threads */}
        {thread.state.alarmStrip && thread.lastInboundAt !== null && (
          <div
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.16em] text-rose"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {t("row.alarmStrip", "// {days}D · UNANSWERED").replace(
              "{days}",
              String(alarmDays),
            )}
          </div>
        )}

        {/* Title row: name · count · state-tag · time */}
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            id={clientNameId}
            className={cn(
              "min-w-0 flex-1 truncate font-mohave text-[13px] tracking-[-0.003em]",
              isUnread ? "font-semibold text-text" : "font-normal text-text-2",
            )}
          >
            {thread.clientName}
          </span>
          {thread.messageCount > 1 && (
            <span
              className="shrink-0 font-mono text-[11px] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              · {thread.messageCount}
            </span>
          )}
          <StateTag
            tone={thread.state.tone}
            variant="bare"
            prefix={thread.state.prefix}
            value={thread.state.value}
            onDismiss={tagDismiss}
            dismissLabel={t(
              "row.dismissAwaitingReply",
              "Mark no reply needed",
            )}
          />
          {showTrailingTime && (
            <span
              className={cn(
                "shrink-0 font-mono text-[11px]",
                isUnread ? "text-text-3" : "text-text-mute",
              )}
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {formatRelativeTime(thread.ts, now)}
            </span>
          )}
        </div>

        {/* Subject line */}
        <div
          id={subjectId}
          className={cn(
            "mt-0.5 truncate font-mohave text-[13px] tracking-[-0.003em]",
            isUnread ? "font-medium text-text" : "font-normal text-text-2",
          )}
        >
          {thread.subject || ""}
        </div>

        {/* Snippet line with optional draft prefix — prefers AI summary over raw snippet */}
        <div className="mt-0.5 truncate font-mohave text-[12px] leading-[1.4] text-text-3">
          {isAiDraft && (
            <span className="mr-1.5 font-cakemono text-[11px] font-light uppercase tracking-[0.16em] text-agent">
              {t("row.claudeDraftPrefix", "// CLAUDE DRAFT ·")}
            </span>
          )}
          {!isAiDraft && hasUserDraft && (
            <span className="mr-1.5 font-cakemono text-[11px] font-light uppercase tracking-[0.16em] text-text-3">
              {t("row.draftPrefix", "DRAFT ·")}
            </span>
          )}
          {thread.aiSummary ?? thread.snippet}
        </div>

        {/* Bottom signal row — attachments / quotes / invoices / new senders only */}
        {showSignalRow && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span
              className="ml-auto flex items-center gap-1 text-text-mute"
            >
              {thread.labels.includes("FROM_NEW_SENDER") && (
                <UserPlus
                  aria-hidden
                  className="h-[14px] w-[14px]"
                  strokeWidth={1.5}
                />
              )}
              {thread.labels.includes("HAS_ATTACHMENT") && (
                <Paperclip
                  aria-hidden
                  className="h-[14px] w-[14px]"
                  strokeWidth={1.5}
                />
              )}
              {thread.labels.includes("HAS_QUOTE") && (
                <DollarSign
                  aria-hidden
                  className="h-[14px] w-[14px]"
                  strokeWidth={1.5}
                />
              )}
              {thread.labels.includes("HAS_INVOICE") && (
                <Receipt
                  aria-hidden
                  className="h-[14px] w-[14px]"
                  strokeWidth={1.5}
                />
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
