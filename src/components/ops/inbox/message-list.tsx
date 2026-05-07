"use client";

/**
 * MessageList — faithful to the simple `messages.map(m => <V3Bubble m={m}/>)`
 * pattern in `reference/v4-detail.jsx :: V4Detail`. No run grouping or day
 * separators in the canonical reference; bubbles are rendered uniformly with
 * 14px gap between them. Photo bubbles can be inserted via the `inlinePhotos`
 * prop (rendered after the message at `afterMessageIdx`).
 */

import { Fragment } from "react";
import { MessageBubble } from "./message-bubble";
import { PhotoBubble, type PhotoData } from "./photo-bubble";
import { cn } from "@/lib/utils/cn";
import type { MessageForGrouping } from "@/lib/inbox/message-grouping";

export interface RenderableMessage extends MessageForGrouping {
  direction: "inbound" | "outbound";
  body: string;
  /** Display name shown in the meta row beneath the bubble. */
  senderName: string;
  /** Render-friendly time, e.g. "14:05". */
  timestamp?: string;
  /** Initials for the avatar tile. */
  initials?: string;
  /** Filename surfaced as a paperclip indicator in the meta row. */
  attachmentName?: string;
}

export interface InlinePhotoEntry {
  /** Index of the message this photo group renders after. */
  afterMessageIdx: number;
  direction: "inbound" | "outbound";
  senderName: string;
  initials?: string;
  timestamp?: string;
  body?: string;
  photos: PhotoData[];
}

interface MessageListProps {
  messages: RenderableMessage[];
  inlinePhotos?: InlinePhotoEntry[];
  className?: string;
}

export function MessageList({
  messages,
  inlinePhotos = [],
  className,
}: MessageListProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto scrollbar-hide px-[18px] py-4",
        className,
      )}
    >
      {messages.map((m, i) => {
        const photoEntry = inlinePhotos.find((p) => p.afterMessageIdx === i);
        return (
          <Fragment key={m.id}>
            <MessageBubble
              direction={m.direction}
              body={m.body}
              source={m.source}
              senderName={m.senderName}
              timestamp={m.timestamp}
              initials={m.initials}
              attachmentName={m.attachmentName}
            />
            {photoEntry && (
              <PhotoBubble
                direction={photoEntry.direction}
                senderName={photoEntry.senderName}
                initials={photoEntry.initials}
                timestamp={photoEntry.timestamp}
                body={photoEntry.body}
                photos={photoEntry.photos}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
