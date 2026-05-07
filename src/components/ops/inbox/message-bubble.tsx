"use client";

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { MessageSource } from "@/lib/inbox/message-grouping";

interface MessageBubbleProps {
  direction: "inbound" | "outbound";
  body: string;
  /** Defaults to "human". When "ai" + outbound, lavender variant + provenance meta. */
  source?: MessageSource;
  /** Last bubble in an author run draws a tail corner + meta line. */
  isLastOfRun: boolean;
  /** Render-friendly time, e.g. "14:05". Only shown when isLastOfRun. */
  timestamp?: string;
  /** Optional avatar element rendered in the inbound gutter (32px). */
  avatar?: ReactNode;
  /** Children render inside the bubble above the body — for photo grids etc. */
  children?: ReactNode;
}

export function MessageBubble({
  direction,
  body,
  source = "human",
  isLastOfRun,
  timestamp,
  avatar,
  children,
}: MessageBubbleProps) {
  const { t } = useDictionary("inbox");
  const isOutbound = direction === "outbound";
  const isAi = source === "ai" && isOutbound;

  const bubbleClass = cn(
    "max-w-[70%] rounded-[10px] px-3 py-2 font-mohave text-[13.5px] leading-[1.5] tracking-[-0.003em] text-text text-pretty",
    isAi
      ? "bg-agent-bg-hi border border-agent-border-hi"
      : isOutbound
        ? "bg-ops-accent/[0.20] border border-ops-accent/[0.22]"
        : "bg-inbox-panel border border-line",
    !isLastOfRun && "rounded-br-[10px] rounded-bl-[10px]",
    isLastOfRun && isOutbound && "rounded-br-[4px]",
    isLastOfRun && !isOutbound && "rounded-bl-[4px]",
  );

  return (
    <div className={cn("flex flex-col", isLastOfRun ? "mt-3.5" : "mt-1")}>
      <div
        className={cn(
          "flex w-full items-end gap-2 px-3.5",
          isOutbound ? "justify-end" : "justify-start",
        )}
      >
        {!isOutbound && (
          <span className="flex w-8 shrink-0 justify-center">
            {isLastOfRun ? avatar : null}
          </span>
        )}
        <div data-testid="message-bubble" className={bubbleClass}>
          {children}
          <p className="whitespace-pre-wrap break-words">{body}</p>
        </div>
      </div>
      {isLastOfRun && (timestamp || isAi) && (
        <div
          className={cn(
            "mt-1 flex items-center gap-1.5 px-3.5 font-mono text-[10px] uppercase tracking-[0.2em] text-text-mute",
            isOutbound ? "justify-end" : "justify-start pl-[58px]",
          )}
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {isAi && (
            <>
              <Sparkles
                aria-hidden
                className="h-2.5 w-2.5 text-agent-text-2"
                strokeWidth={1.75}
              />
              <span className="text-agent-text-2">{t("messages.sentByClaude", "sent by Claude")}</span>
            </>
          )}
          {isAi && timestamp && <span aria-hidden>·</span>}
          {timestamp && <span>{timestamp}</span>}
        </div>
      )}
    </div>
  );
}
