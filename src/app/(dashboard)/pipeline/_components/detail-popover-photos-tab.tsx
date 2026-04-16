"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Camera } from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import { type Activity, ActivityType } from "@/lib/types/pipeline";
import { useOpportunityActivities, useSiteVisits } from "@/lib/hooks";

// ── Utilities ──

const IMG_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i;

interface PhotoRecord {
  url: string;
  date: Date;
  source: string;
}

function collectPhotos(
  activities: Activity[],
  siteVisits: Array<{ photos: string[]; scheduledAt: Date | string }>,
  locale: Locale,
): PhotoRecord[] {
  const photos: PhotoRecord[] = [];

  for (const a of activities) {
    if (a.type !== ActivityType.Email) continue;
    for (const url of a.attachments) {
      if (IMG_RE.test(url)) {
        const d = new Date(a.createdAt);
        photos.push({
          url,
          date: d,
          source: `Email — ${d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" })}`,
        });
      }
    }
  }

  for (const sv of siteVisits) {
    for (const url of sv.photos) {
      const d = new Date(sv.scheduledAt);
      photos.push({
        url,
        date: d,
        source: `Site visit — ${d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" })}`,
      });
    }
  }

  photos.sort((a, b) => b.date.getTime() - a.date.getTime());
  return photos;
}

// ── Lightbox with arrow nav ──

function PhotoLightbox({
  photos,
  activeIndex,
  onClose,
  onNavigate,
}: {
  photos: PhotoRecord[];
  activeIndex: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && activeIndex > 0) onNavigate(activeIndex - 1);
      if (e.key === "ArrowRight" && activeIndex < photos.length - 1)
        onNavigate(activeIndex + 1);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeIndex, photos.length, onClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Left arrow */}
      {activeIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(activeIndex - 1); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[rgba(255,255,255,0.1)] flex items-center justify-center text-white/60 hover:text-white hover:bg-[rgba(255,255,255,0.2)] transition-colors"
        >
          <span className="font-mono text-[14px]">&lsaquo;</span>
        </button>
      )}

      <img
        src={photos[activeIndex].url}
        alt=""
        className="max-w-[80vw] max-h-[80vh] object-contain rounded-[4px]"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Right arrow */}
      {activeIndex < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(activeIndex + 1); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[rgba(255,255,255,0.1)] flex items-center justify-center text-white/60 hover:text-white hover:bg-[rgba(255,255,255,0.2)] transition-colors"
        >
          <span className="font-mono text-[14px]">&rsaquo;</span>
        </button>
      )}

      {/* Counter */}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[11px] text-white/50">
        {activeIndex + 1} / {photos.length}
      </span>
    </div>
  );
}

// ── Exported tab ──

interface DetailPopoverPhotosTabProps {
  opportunityId: string;
}

export function DetailPopoverPhotosTab({
  opportunityId,
}: DetailPopoverPhotosTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const { data: activities } = useOpportunityActivities(opportunityId);
  const { data: siteVisits } = useSiteVisits({ opportunityId });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const photos = useMemo(
    () => collectPhotos(activities ?? [], siteVisits ?? [], locale),
    [activities, siteVisits, locale]
  );

  const handleNavigate = useCallback((idx: number) => {
    setLightboxIndex(idx);
  }, []);

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Camera className="w-5 h-5 text-text-mute mb-2" />
        <span className="font-kosugi text-[11px] text-text-mute">
          {t("detail.noPhotosYet")}
        </span>
      </div>
    );
  }

  return (
    <>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 96px))" }}
      >
        {photos.map((photo, idx) => (
          <button
            key={`${photo.url}-${idx}`}
            onClick={() => setLightboxIndex(idx)}
            className="group relative aspect-square rounded-[3px] overflow-hidden border border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.20)] transition-colors"
          >
            <img
              src={photo.url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-0.5">
              <span className="font-mono text-[8px] text-white/70">
                {photo.source}
              </span>
            </div>
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={handleNavigate}
        />
      )}
    </>
  );
}
