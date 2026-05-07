"use client";

/**
 * MessageBubble — faithful to `reference/v3-messages.jsx :: V3Bubble`.
 *
 * One bubble per message. No run-tail logic, no shared avatar gutter — every
 * message renders its avatar (square, 26px). Outbound bubbles use the accent
 * fill (`rgba(111,148,176,0.10)`); AI-authored outbound bubbles use the agent
 * fill. Meta row (sender · time · optional attachment) sits directly under
 * the bubble in the same column, gap 4.
 *
 * Children render INSIDE the bubble above the body — for inline photo grids.
 */

import { Paperclip, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { MessageSource } from "@/lib/inbox/message-grouping";

interface MessageBubbleProps {
  direction: "inbound" | "outbound";
  body: string;
  /** Defaults to "human". When "ai" + outbound, lavender variant + provenance. */
  source?: MessageSource;
  /** Display name above the meta row. */
  senderName: string;
  /** Render-friendly time, e.g. "14:05". */
  timestamp?: string;
  /** Initials shown in the avatar tile (max 2 chars). */
  initials?: string;
  /** Filename for an attachment indicator in the meta row. */
  attachmentName?: string;
  /** Children render inside the bubble above the body — used for photo grids. */
  children?: ReactNode;
  className?: string;
}

function safeInitials(value: string | undefined, fallback: string): string {
  const seed = (value && value.trim()) || fallback;
  const parts = seed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

export function MessageBubble({
  direction,
  body,
  source = "human",
  senderName,
  timestamp,
  initials,
  attachmentName,
  children,
  className,
}: MessageBubbleProps) {
  const { t } = useDictionary("inbox");
  const isOutbound = direction === "outbound";
  const isAi = source === "ai" && isOutbound;

  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isOutbound ? "flex-row-reverse" : "flex-row",
        className,
      )}
    >
      <Avatar initials={safeInitials(initials, senderName)} agent={isAi} />
      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1",
          isOutbound ? "items-end" : "items-start",
        )}
      >
        <div
          data-testid="message-bubble"
          className={cn(
            "rounded-panel border px-3.5 py-2.5 font-mohave text-[13.5px] leading-[1.5] tracking-[-0.003em] text-pretty",
            isAi
              ? "border-agent-border-hi bg-agent/[0.10] text-agent-text"
              : isOutbound
                ? "border-ops-accent/[0.22] bg-ops-accent/[0.10] text-text"
                : "border-line bg-inbox-panel text-text",
          )}
        >
          {children}
          <p className="whitespace-pre-wrap break-words">{body}</p>
        </div>
        <div
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {isAi ? (
            <span className="inline-flex items-center gap-1 text-agent-text-2">
              <Sparkles aria-hidden className="h-2.5 w-2.5" strokeWidth={1.75} />
              {t("messages.sentByClaude", "Claude")}
            </span>
          ) : (
            <span className="text-text-3">{senderName}</span>
          )}
          {timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{timestamp}</span>
            </>
          )}
          {attachmentName && (
            <>
              <span aria-hidden className="ml-1">·</span>
              <span className="inline-flex items-center gap-1 text-text-3">
                <Paperclip aria-hidden className="h-2.5 w-2.5" strokeWidth={1.75} />
                {attachmentName}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Avatar({ initials, agent }: { initials: string; agent: boolean }) {
  if (agent) {
    return (
      <span
        aria-hidden
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-chip border border-agent-border-hi bg-agent/[0.15] text-agent"
      >
        <Sparkles aria-hidden className="h-3 w-3" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-chip border border-line-hi bg-inbox-elev font-mohave text-[10.5px] tracking-[0.02em] text-text-2"
    >
      {initials}
    </span>
  );
}
