"use client";

/**
 * PhotoBubble — faithful to `reference/v4-detail.jsx :: V4PhotoBubble`.
 *
 * Renders a 1/2/3-column photo grid (max-w 360) above an optional body
 * bubble. Avatar always present (square 26px). Meta row directly under the
 * stack: sender · time · "{n} photos" with image icon.
 */

import { Image as ImageIcon, Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface PhotoData {
  id: string;
  url: string;
  alt?: string;
}

export function photoGridCols(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

interface PhotoBubbleProps {
  direction: "inbound" | "outbound";
  photos: PhotoData[];
  body?: string;
  senderName: string;
  initials?: string;
  timestamp?: string;
  onPhotoClick?: (photo: PhotoData, index: number) => void;
  agent?: boolean;
}

const COL_CLASS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

const TILE_HEIGHT: Record<1 | 2 | 3, string> = {
  1: "h-[200px]",
  2: "h-[140px]",
  3: "h-[96px]",
};

function safeInitials(value: string | undefined, fallback: string): string {
  const seed = (value && value.trim()) || fallback;
  const parts = seed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

export function PhotoBubble({
  direction,
  photos,
  body,
  senderName,
  initials,
  timestamp,
  onPhotoClick,
  agent,
}: PhotoBubbleProps) {
  const { t } = useDictionary("inbox");
  if (photos.length === 0) return null;

  const isOutbound = direction === "outbound";
  const cols = photoGridCols(photos.length) as 1 | 2 | 3;
  const count = photos.length;
  const photoLabel = t(
    count === 1 ? "messages.photo_one" : "messages.photo_other",
    count === 1 ? "{count} photo" : "{count} photos",
  ).replace("{count}", String(count));

  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isOutbound ? "flex-row-reverse" : "flex-row",
      )}
    >
      {agent ? (
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-chip border border-agent-border-hi bg-agent/[0.15] text-agent"
        >
          <Sparkles aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </span>
      ) : (
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-chip border border-line-hi bg-inbox-elev font-mohave text-[10.5px] tracking-[0.02em] text-text-2"
        >
          {safeInitials(initials, senderName)}
        </span>
      )}
      <div
        className={cn(
          "flex max-w-[360px] flex-col gap-1.5",
          isOutbound ? "items-end" : "items-start",
        )}
      >
        <div
          data-testid="photo-grid"
          className={cn("grid w-full gap-1", COL_CLASS[cols])}
        >
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              aria-label={t("files.openPhoto", "Open photo {filename}").replace(
                "{filename}",
                photo.alt ?? `photo-${i + 1}`,
              )}
              onClick={() => onPhotoClick?.(photo, i)}
              className={cn(
                "shrink-0 overflow-hidden rounded-md border border-line bg-inbox-bg-deep transition-transform hover:scale-[1.01]",
                TILE_HEIGHT[cols],
                cols === 1 ? "w-full" : "",
              )}
            >
              <img
                src={photo.url}
                alt={photo.alt ?? ""}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
        {body && (
          <div
            className={cn(
              "rounded-panel border px-3.5 py-2.5 font-mohave text-[13.5px] leading-[1.5] tracking-[-0.003em] text-pretty",
              isOutbound
                ? "border-ops-accent/[0.22] bg-ops-accent/[0.10] text-text"
                : "border-line bg-inbox-panel text-text",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{body}</p>
          </div>
        )}
        <div
          className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-text-mute"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          <span className="text-text-3">{senderName}</span>
          {timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{timestamp}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-text-3">
            <ImageIcon
              aria-hidden
              className="h-2.5 w-2.5"
              strokeWidth={1.75}
            />
            {photoLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
