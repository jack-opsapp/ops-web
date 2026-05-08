"use client";

/**
 * MessageBubble — faithful to `reference/v3-messages.jsx :: V3Bubble`.
 *
 * One bubble per message. No run-tail logic, no shared avatar gutter — every
 * message renders its avatar (round, 26px). Outbound bubbles use the accent
 * fill (`rgba(111,148,176,0.10)`); AI-authored outbound bubbles use the
 * agent fill. Meta row (sender · time · optional attachment) sits directly
 * under the bubble in the same column, gap 4. Mono meta uses canonical
 * `letterSpacing: 0.2px` (drop the wide em tracking).
 *
 * Children render INSIDE the bubble above the body — for inline photo grids.
 */

import { Paperclip, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { MessageSource } from "@/lib/inbox/message-grouping";
import { InboxAvatar } from "./avatar";

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
      <InboxAvatar
        name={senderName}
        initials={initials}
        size={26}
        agent={isAi}
      />
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
          className="flex items-center gap-1.5 font-mono text-[10px] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {isAi ? (
            <span className="inline-flex items-center gap-1 text-agent-text-2">
              <Sparkles aria-hidden className="h-2.5 w-2.5" strokeWidth={1.5} />
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
              <span aria-hidden className="ml-1">
                ·
              </span>
              <span className="inline-flex items-center gap-1 text-text-3">
                <Paperclip
                  aria-hidden
                  className="h-2.5 w-2.5"
                  strokeWidth={1.5}
                />
                {attachmentName}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
