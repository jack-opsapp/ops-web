"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import type { InboxMessage, EmailAttachment } from "@/lib/types/unified-inbox";

interface MessageBubbleProps {
  message: InboxMessage;
  /** Hide timestamp for grouped consecutive messages from same sender */
  showTimestamp?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentImage({
  attachment,
  messageId,
}: {
  attachment: EmailAttachment;
  messageId: string;
}) {
  const companyId = useAuthStore((s) => s.company?.id);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!companyId || !messageId) return null;

  const src = `/api/integrations/email/attachment?companyId=${companyId}&messageId=${messageId}&attachmentId=${encodeURIComponent(attachment.attachmentId)}&mimeType=${encodeURIComponent(attachment.mimeType)}`;

  if (error) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[3px] bg-background-card border border-border-subtle">
        <ImageIcon className="w-3.5 h-3.5 text-text-disabled" />
        <span className="font-mohave text-caption-sm text-text-disabled truncate">
          {attachment.filename}
        </span>
        <span className="font-kosugi text-micro-sm text-text-disabled">
          {formatFileSize(attachment.size)}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="block rounded-[3px] overflow-hidden border border-border-subtle hover:border-ops-accent/30 transition-colors cursor-pointer"
      >
        {!loaded && (
          <div className="w-[200px] h-[120px] bg-background-card animate-pulse flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-text-disabled" />
          </div>
        )}
        <img
          src={src}
          alt={attachment.filename}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "max-w-[280px] max-h-[200px] object-cover",
            loaded ? "block" : "hidden"
          )}
        />
      </button>

      {/* Expanded lightbox — portaled to document.body to escape overflow/stacking contexts */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/85 backdrop-blur-sm p-16"
          onClick={() => setExpanded(false)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="absolute top-6 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] border border-border-subtle bg-background-card text-text-secondary font-kosugi text-micro-sm uppercase tracking-wider hover:bg-background-input hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
          <img
            src={src}
            alt={attachment.filename}
            className="max-w-full max-h-full object-contain rounded-[3px]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}

export function MessageBubble({ message, showTimestamp = true }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";

  const imageAttachments = message.attachments?.filter((a) =>
    a.mimeType.startsWith("image/")
  ) ?? [];
  const nonImageAttachments = message.attachments?.filter(
    (a) => !a.mimeType.startsWith("image/")
  ) ?? [];
  const hasNonImageAttachments = nonImageAttachments.length > 0 ||
    (message.hasAttachments && imageAttachments.length === 0 && message.attachments?.length === 0);

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[65%] min-w-[120px]")}>
        <div
          className={cn(
            "px-3 py-2.5",
            isOutbound
              ? "bg-ops-accent-muted rounded-[3px_3px_1px_3px]"
              : "bg-background-input rounded-[3px_3px_3px_1px]"
          )}
        >
          <p className="font-mohave text-body-sm text-text-secondary whitespace-pre-wrap break-words">
            {message.content || (
              <span className="italic text-text-disabled">No message content available.</span>
            )}
          </p>

          {/* Image attachments */}
          {imageAttachments.length > 0 && (
            <div className={cn(
              "flex flex-wrap gap-2 mt-2",
              message.content && "pt-2 border-t border-border-subtle"
            )}>
              {imageAttachments.map((att) => (
                <AttachmentImage
                  key={att.attachmentId}
                  attachment={att}
                  messageId={message.emailMessageId ?? ""}
                />
              ))}
            </div>
          )}

          {/* Non-image attachment indicator */}
          {hasNonImageAttachments && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border-subtle">
              <Paperclip className="w-3 h-3 text-text-disabled" />
              <span className="font-kosugi text-micro-sm text-text-disabled">
                {nonImageAttachments.length || message.attachmentCount} attachment
                {(nonImageAttachments.length || message.attachmentCount) > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>

        {/* Timestamp + sender */}
        {showTimestamp && (
          <div className={cn(
            "flex items-center gap-1.5 mt-0.5 px-1",
            isOutbound ? "justify-end" : "justify-start"
          )}>
            <span className="font-kosugi text-micro-sm text-text-disabled">
              {formatTime(message.timestamp)}
            </span>
            {!isOutbound && message.senderEmail && (
              <span className="font-kosugi text-micro-sm text-text-disabled truncate max-w-[200px]">
                <span className="text-text-disabled/50 mx-0.5">&middot;</span>
                {message.senderEmail}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
