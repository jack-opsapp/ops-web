"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { MessageSource } from "@/lib/inbox/message-grouping";

export interface PhotoItem {
  id: string;
  url: string;
  filename: string;
}

export function photoGridCols(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

interface PhotoBubbleProps {
  direction: "inbound" | "outbound";
  photos: PhotoItem[];
  body?: string;
  source?: MessageSource;
  isLastOfRun: boolean;
  timestamp?: string;
  onPhotoClick?: (photo: PhotoItem, index: number) => void;
}

const COL_CLASS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

export function PhotoBubble({
  direction,
  photos,
  body,
  source = "human",
  isLastOfRun,
  timestamp,
  onPhotoClick,
}: PhotoBubbleProps) {
  if (photos.length === 0) return null;

  const isOutbound = direction === "outbound";
  const isAi = source === "ai" && isOutbound;
  const cols = photoGridCols(photos.length) as 1 | 2 | 3;
  const count = photos.length;

  const bubbleClass = cn(
    "max-w-[360px] rounded-[10px] p-1 font-mohave text-[13.5px] leading-[1.5] tracking-[-0.003em] text-text",
    isAi
      ? "bg-agent-bg-hi border border-agent-border-hi"
      : isOutbound
        ? "bg-ops-accent/[0.20] border border-ops-accent/[0.22]"
        : "bg-inbox-panel border border-line",
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
        {!isOutbound && <span className="w-8 shrink-0" />}
        <div className={bubbleClass}>
          <div
            data-testid="photo-grid"
            className={cn("grid gap-1", COL_CLASS[cols])}
          >
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                aria-label={`Open photo ${photo.filename}`}
                onClick={() => onPhotoClick?.(photo, i)}
                className="aspect-square overflow-hidden rounded-[6px] border border-line bg-inbox-bg-deep"
              >
                <img
                  src={photo.url}
                  alt={photo.filename}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
          {body && (
            <p className="whitespace-pre-wrap break-words px-2 pb-1.5 pt-2">
              {body}
            </p>
          )}
        </div>
      </div>
      {isLastOfRun && (
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
              <span className="text-agent-text-2">sent by Claude</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>
            {count} {count === 1 ? "photo" : "photos"}
          </span>
          {timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{timestamp}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
