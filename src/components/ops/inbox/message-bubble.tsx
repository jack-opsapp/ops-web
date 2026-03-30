"use client";

import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { InboxMessage } from "@/lib/types/unified-inbox";

interface MessageBubbleProps {
  message: InboxMessage;
  /** Hide timestamp for grouped consecutive messages from same sender */
  showTimestamp?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessageBubble({ message, showTimestamp = true }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className="max-w-[70%]">
        {/* Bubble */}
        <div
          className={cn(
            "px-3.5 py-3 border",
            isOutbound
              ? "bg-[rgba(89,119,148,0.12)] border-[rgba(89,119,148,0.18)] rounded-[3px_3px_1px_3px]"
              : "bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] rounded-[3px_3px_3px_1px]"
          )}
        >
          <p className="font-mohave text-body-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
            {message.content || (
              <span className="italic text-text-disabled">No message content available.</span>
            )}
          </p>

          {/* Attachment indicator */}
          {message.hasAttachments && message.attachmentCount > 0 && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
              <Paperclip className="w-3 h-3 text-text-disabled" />
              <span className="font-kosugi text-micro-sm text-text-disabled">
                {message.attachmentCount} attachment{message.attachmentCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Metadata below bubble */}
        {showTimestamp && (
          <div
            className={cn(
              "flex items-center gap-1.5 mt-1 px-1",
              isOutbound ? "justify-end" : "justify-start"
            )}
          >
            <span className="font-kosugi text-micro-sm text-text-disabled">
              {formatTime(message.timestamp)}
            </span>
            {!isOutbound && message.senderEmail && (
              <>
                <span className="text-text-disabled text-micro-sm">&middot;</span>
                <span className="font-mohave text-micro-sm text-text-disabled">
                  {message.senderEmail}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
