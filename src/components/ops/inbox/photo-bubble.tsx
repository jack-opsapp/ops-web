"use client";

/**
 * PhotoBubble — Phase F3 inline photo grids.
 *
 * Layout rules:
 *   1 photo     → grid-cols-1, single tall image (max-h ~360px)
 *   2 photos    → grid-cols-2, side-by-side
 *   3+ photos   → grid-cols-2, 2-row grid (4 visible cells max)
 *                 When length > 4, the 4th cell carries a dim-overlay reading
 *                 `+N MORE` where N = photos.length - 4.
 *
 * Avatar always present (round 26px via shared InboxAvatar). Meta row directly
 * under the stack: `sender · time · {N} PHOTOS` (uppercase tactical voice;
 * the legacy <ImageIcon> has been dropped — count carries the meaning).
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { InboxAvatar } from "./avatar";

export interface PhotoData {
  id: string;
  url: string;
  alt?: string;
}

/**
 * photoGridCols — semantic column count for a given photo count.
 * 1 → 1 column, 2 → 2 columns, 3+ → 2 columns (Phase F3: 2x2 grid).
 */
export function photoGridCols(count: number): 0 | 1 | 2 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  return 2;
}

interface PhotoBubbleProps {
  direction: "inbound" | "outbound";
  photos: PhotoData[];
  body?: string;
  senderName: string;
  initials?: string;
  timestamp?: string;
  // TODO(lightbox): hook up to a fullscreen lightbox when that surface lands.
  onPhotoClick?: (photo: PhotoData, index: number) => void;
  agent?: boolean;
}

const COL_CLASS: Record<1 | 2, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
};

const TILE_HEIGHT: Record<"single" | "pair" | "grid", string> = {
  single: "h-[360px]",
  pair: "h-[180px]",
  grid: "h-[140px]",
};

const MAX_VISIBLE_CELLS = 4;

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
  const cols = photoGridCols(photos.length) as 1 | 2;
  const total = photos.length;

  // Visible cells: cap at 4 for the 2x2 layout. 1 / 2 photos render all.
  const visibleCount = total > MAX_VISIBLE_CELLS ? MAX_VISIBLE_CELLS : total;
  const visiblePhotos = photos.slice(0, visibleCount);
  const overflow = total - MAX_VISIBLE_CELLS;
  const hasOverflow = overflow > 0;

  const tileSize: keyof typeof TILE_HEIGHT =
    total === 1 ? "single" : total === 2 ? "pair" : "grid";

  const photoLabel = t(
    total === 1 ? "messages.photoCountTactic_one" : "messages.photoCountTactic_other",
    total === 1 ? "{count} PHOTO" : "{count} PHOTOS",
  ).replace("{count}", String(total));

  const overflowLabel = t(
    "messages.photoOverflow",
    "+{count} MORE",
  ).replace("{count}", String(overflow));

  return (
    <div
      className={cn(
        "flex w-full gap-2.5",
        isOutbound ? "flex-row-reverse" : "flex-row",
      )}
    >
      <InboxAvatar
        name={senderName}
        initials={initials}
        size={24}
        agent={agent}
      />
      <div
        className={cn(
          "flex max-w-[336px] flex-col gap-1.5",
          isOutbound ? "items-end" : "items-start",
        )}
      >
        <div
          data-testid="photo-grid"
          className={cn("grid w-full gap-1", COL_CLASS[cols])}
        >
          {visiblePhotos.map((photo, i) => {
            const isOverflowCell = hasOverflow && i === MAX_VISIBLE_CELLS - 1;
            const filename = photo.alt ?? `photo-${i + 1}`;
            const ariaLabel = isOverflowCell
              ? t(
                  "files.openPhotoOverflow",
                  "Open photo {filename} (+{count} more)",
                )
                  .replace("{filename}", filename)
                  .replace("{count}", String(overflow))
              : t("files.openPhoto", "Open photo {filename}").replace(
                  "{filename}",
                  filename,
                );

            return (
              <button
                key={photo.id}
                type="button"
                aria-label={ariaLabel}
                onClick={() => onPhotoClick?.(photo, i)}
                className={cn(
                  "relative shrink-0 overflow-hidden rounded border border-line bg-transparent transition-transform hover:scale-[1.01]",
                  TILE_HEIGHT[tileSize],
                  cols === 1 ? "w-full" : "",
                )}
              >
                <img
                  src={photo.url}
                  alt={photo.alt ?? ""}
                  className="h-full w-full object-cover"
                />
                {isOverflowCell && (
                  <span
                    aria-hidden
                    data-testid="photo-overflow"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/[0.55] font-mono text-[11px] uppercase tracking-[0.18em] text-text"
                    style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                  >
                    {overflowLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {body && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 font-mohave text-[13px] leading-[1.45] text-pretty",
              isOutbound
                ? "border-ops-accent/[0.32] bg-transparent text-text"
                : "border-line bg-transparent text-text",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{body}</p>
          </div>
        )}
        <div
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-mute"
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
          <span className="text-text-3">{photoLabel}</span>
        </div>
      </div>
    </div>
  );
}
