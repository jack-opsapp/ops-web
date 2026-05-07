"use client";

/**
 * ThreadRow — faithful port of `reference/v3-columns.jsx :: V3FeedRow`.
 *
 * Anatomy (top → bottom inside a relative container with optional left stripe):
 *   • title row: client name + message count + relative time
 *   • subject line (font-weight tracks unread/read)
 *   • snippet line with optional "AI DRAFT ·" / "DRAFT ·" cake prefix
 *   • bottom signal row — only when at least one signal is present:
 *       URGENT pill on the left; paperclip / dollar / receipt / user-plus
 *       icons on the right
 *
 * The left stripe is decorative only. Width 2px normally, 3px when the row is
 * the active selection. Color: rose for URGENT, lavender for AI-drafted, accent
 * when selected, otherwise transparent. Opacity tracks unread.
 *
 * Avatar is square (radius 4) per V3Avatar — never round in this design.
 */

import {
  DollarSign,
  Paperclip,
  Receipt,
  UserPlus,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ThreadForGrouping } from "@/lib/inbox/grouping";

export interface ThreadRowData extends ThreadForGrouping {
  clientName: string;
  subject: string;
  snippet: string;
  unread: boolean;
  /** Total messages in the thread. Renders inline as `· {n}` when > 1. */
  messageCount: number;
  /** Drives the snippet prefix tag. */
  draftKind?: "ai" | "user" | null;
  avatarUrl?: string | null;
}

interface ThreadRowProps {
  thread: ThreadRowData;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
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
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export function ThreadRow({ thread, selected, now, onSelect }: ThreadRowProps) {
  const { t } = useDictionary("inbox");
  const isUrgent = thread.labels.includes("URGENT");
  const isAiDraft = thread.phaseC === "ai_drafted" || thread.draftKind === "ai";
  const hasUserDraft = thread.draftKind === "user";
  const isUnread = thread.unread;

  const showSignalRow =
    thread.labels.includes("URGENT") ||
    thread.labels.includes("HAS_ATTACHMENT") ||
    thread.labels.includes("HAS_QUOTE") ||
    thread.labels.includes("HAS_INVOICE") ||
    thread.labels.includes("FROM_NEW_SENDER");

  // Stripe (decorative): width changes on selection, color reflects state.
  const stripeColor = selected
    ? "bg-ops-accent"
    : isUrgent
      ? "bg-rose"
      : isAiDraft
        ? "bg-agent"
        : "bg-transparent";

  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-start gap-3 border-b border-line text-left",
        "py-2.5 pl-[18px] pr-3.5",
        selected
          ? "bg-ops-accent/[0.07]"
          : "hover:bg-inbox-elev/60",
      )}
    >
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

      <Avatar name={thread.clientName} url={thread.avatarUrl ?? null} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title row: name · count · time */}
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mohave text-[13.5px] tracking-[-0.003em]",
              isUnread
                ? "font-semibold text-text"
                : "font-normal text-text-2",
            )}
          >
            {thread.clientName}
          </span>
          {thread.messageCount > 1 && (
            <span
              className="shrink-0 font-mono text-[10px] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              · {thread.messageCount}
            </span>
          )}
          <span
            className={cn(
              "shrink-0 font-mono text-[10.5px] uppercase tracking-[0.2em]",
              isUnread ? "text-text-3" : "text-text-mute",
            )}
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {formatRelativeTime(thread.ts, now)}
          </span>
        </div>

        {/* Subject line */}
        <div
          className={cn(
            "mt-0.5 truncate font-mohave text-[13px] tracking-[-0.003em]",
            isUnread
              ? "font-medium text-text"
              : "font-normal text-text-2",
          )}
        >
          {thread.subject || ""}
        </div>

        {/* Snippet line with optional draft prefix */}
        <div className="mt-0.5 truncate font-mohave text-[12px] leading-[1.4] text-text-3">
          {isAiDraft && (
            <span className="mr-1.5 font-cakemono text-[9.5px] font-light uppercase tracking-[0.16em] text-agent">
              {t("row.aiDraftPrefix", "AI DRAFT ·")}
            </span>
          )}
          {!isAiDraft && hasUserDraft && (
            <span className="mr-1.5 font-cakemono text-[9.5px] font-light uppercase tracking-[0.16em] text-text-3">
              {t("row.draftPrefix", "DRAFT ·")}
            </span>
          )}
          {thread.snippet}
        </div>

        {/* Bottom signal row */}
        {showSignalRow && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {thread.labels.includes("URGENT") && (
              <span
                data-testid="thread-row-urgent"
                className="inline-flex items-center gap-1 font-cakemono text-[9px] font-light uppercase tracking-[0.16em] text-rose"
              >
                <span aria-hidden className="leading-none">●</span>
                <span>{t("row.urgent", "URGENT")}</span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-text-mute">
              {thread.labels.includes("FROM_NEW_SENDER") && (
                <UserPlus aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} />
              )}
              {thread.labels.includes("HAS_ATTACHMENT") && (
                <Paperclip aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} />
              )}
              {thread.labels.includes("HAS_QUOTE") && (
                <DollarSign aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} />
              )}
              {thread.labels.includes("HAS_INVOICE") && (
                <Receipt aria-hidden className="h-[11px] w-[11px]" strokeWidth={1.75} />
              )}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        className="h-7 w-7 shrink-0 rounded-chip border border-line-hi object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-chip border border-line-hi bg-inbox-elev font-mohave text-[10.5px] tracking-[0.02em] text-text-2"
    >
      {monogram(name)}
    </span>
  );
}
