"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ThreadForGrouping } from "@/lib/inbox/grouping";

export interface ThreadRowData extends ThreadForGrouping {
  clientName: string;
  snippet: string;
  unread: boolean;
  /** ISO avatar URL — optional. Falls back to monogram from clientName. */
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
  const date = new Date(ts);
  return date
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export function ThreadRow({ thread, selected, now, onSelect }: ThreadRowProps) {
  const { t } = useDictionary("inbox");
  const isUrgent = thread.labels.includes("URGENT");
  const isAiDraft = thread.phaseC === "ai_drafted";
  const needsInput = thread.agent.needsInput;
  const isUnread = thread.unread;

  const stripeClass = selected
    ? "bg-ops-accent w-[3px]"
    : isUrgent
      ? "bg-rose w-[2px]"
      : isAiDraft
        ? "bg-agent w-[2px]"
        : "bg-transparent w-[2px]";

  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left",
        "border-b border-line/40",
        selected ? "bg-ops-accent/[0.07]" : "hover:bg-inbox-elev",
      )}
    >
      <span
        data-testid="thread-row-stripe"
        aria-hidden
        className={cn(
          "absolute left-0 top-0 h-full",
          stripeClass,
        )}
      />

      <Avatar name={thread.clientName} url={thread.avatarUrl ?? null} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 truncate font-mohave text-[13px] tracking-[-0.003em]",
              isUnread
                ? "font-semibold text-text"
                : "font-medium text-text-2",
            )}
          >
            {thread.clientName}
          </span>

          {isAiDraft && (
            <span className="shrink-0 font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.16em] text-agent">
              {t("row.aiDraft", "›AI-DRAFT")}
            </span>
          )}

          {needsInput && (
            <span
              data-testid="thread-row-needs-input"
              className="shrink-0 rounded-chip border border-agent-border-hi px-1.5 py-px font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.16em] text-agent"
            >
              ?
            </span>
          )}

          <span
            className={cn(
              "ml-auto shrink-0 font-mono text-[10.5px] uppercase leading-none tracking-[0.2em]",
              isUnread ? "text-text-3" : "text-text-mute",
            )}
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {formatRelativeTime(thread.ts, now)}
          </span>
        </div>

        <span className="truncate font-mohave text-[12px] leading-[1.4] text-text-3">
          {thread.snippet}
        </span>
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
        className="size-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-inbox-elev font-mono text-[10px] uppercase tracking-[0.08em] text-text-2"
    >
      {monogram(name)}
    </span>
  );
}
