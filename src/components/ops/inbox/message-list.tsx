"use client";

import { useMemo } from "react";
import {
  annotateMessages,
  type MessageForGrouping,
} from "@/lib/inbox/message-grouping";
import { MessageBubble } from "./message-bubble";
import { cn } from "@/lib/utils/cn";

export interface RenderableMessage extends MessageForGrouping {
  direction: "inbound" | "outbound";
  body: string;
  /** Render-friendly time, e.g. "14:05". Only shown on the last bubble of a run. */
  timestamp?: string;
  /** Optional avatar element rendered in the inbound gutter on run-tail bubbles. */
  avatar?: React.ReactNode;
}

interface MessageListProps {
  messages: RenderableMessage[];
  className?: string;
}

function formatDayLabel(ts: number): string {
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export function MessageList({ messages, className }: MessageListProps) {
  const annotated = useMemo(() => annotateMessages(messages), [messages]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide py-3",
        className,
      )}
    >
      {annotated.map(({ message, isLastOfRun, dayBoundary }) => (
        <div key={message.id}>
          {dayBoundary && (
            <div
              data-testid="message-day-separator"
              className="my-3 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {formatDayLabel(message.ts)}
            </div>
          )}
          <MessageBubble
            direction={message.direction}
            body={message.body}
            source={message.source}
            isLastOfRun={isLastOfRun}
            timestamp={isLastOfRun ? message.timestamp : undefined}
            avatar={message.avatar}
          />
        </div>
      ))}
    </div>
  );
}
