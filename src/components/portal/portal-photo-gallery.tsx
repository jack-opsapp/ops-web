"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, ChevronDown, Images } from "lucide-react";
import { useDictionary } from "@/i18n/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  source: string;
  caption: string | null;
}

interface PortalPhotoGalleryProps {
  photos: PhotoItem[];
}

// ─── Source grouping ──────────────────────────────────────────────────────────

const SOURCE_ORDER: Record<string, number> = {
  site_visit: 0,
  in_progress: 1,
  completion: 2,
};

const SOURCE_KEYS: Record<string, string> = {
  site_visit: "gallery.sourceSiteVisit",
  in_progress: "gallery.sourceInProgress",
  completion: "gallery.sourceCompletion",
};

function getSourceLabel(source: string, t: (key: string) => string): string {
  const key = SOURCE_KEYS[source];
  if (key) return t(key);
  return source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PREVIEW_COUNT = 6;

// ─── Component ────────────────────────────────────────────────────────────────

export function PortalPhotoGallery({ photos }: PortalPhotoGalleryProps) {
  const { t } = useDictionary("portal");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const isOpen = lightboxIndex !== null;

  // ── Grouped photos by source ──────────────────────────────────────────────
  const groupedPhotos = useMemo(() => {
    const groups = new Map<string, PhotoItem[]>();
    for (const photo of photos) {
      const existing = groups.get(photo.source);
      if (existing) {
        existing.push(photo);
      } else {
        groups.set(photo.source, [photo]);
      }
    }

    // Sort groups by source order
    return Array.from(groups.entries()).sort(
      (a, b) => (SOURCE_ORDER[a[0]] ?? 99) - (SOURCE_ORDER[b[0]] ?? 99)
    );
  }, [photos]);

  // ── Flat photo list for lightbox navigation ───────────────────────────────
  const flatPhotos = useMemo(() => photos, [photos]);

  // ── Preview photos (latest 4-6) ──────────────────────────────────────────
  const previewPhotos = useMemo(
    () => photos.slice(0, PREVIEW_COUNT),
    [photos]
  );

  // ── Lightbox navigation ───────────────────────────────────────────────────
  const goToPrevious = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex === 0 ? flatPhotos.length - 1 : lightboxIndex - 1);
  }, [lightboxIndex, flatPhotos.length]);

  const goToNext = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex === flatPhotos.length - 1 ? 0 : lightboxIndex + 1);
  }, [lightboxIndex, flatPhotos.length]);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  function openLightboxForPhoto(photoId: string) {
    const index = flatPhotos.findIndex((p) => p.id === photoId);
    if (index >= 0) setLightboxIndex(index);
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNext();
          break;
        case "Escape":
          e.preventDefault();
          closeLightbox();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToPrevious, goToNext, closeLightbox]);

  // ── Prevent body scroll when lightbox is open ─────────────────────────────
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (photos.length === 0) return null;

  return (
    <>
      {/* ── Default view: horizontal scroll row ──────────────────────────── */}
      {!showAll && (
        <div>
          <div
            className="flex gap-[var(--portal-gallery-gap,8px)] overflow-x-auto pb-2 scrollbar-hide"
          >
            {previewPhotos.map((photo) => (
              <button
                key={photo.id}
                onClick={() => openLightboxForPhoto(photo.id)}
                className="relative shrink-0 overflow-hidden group"
                style={{
                  borderRadius: "var(--portal-gallery-item-radius, var(--portal-radius))",
                  width: 140,
                  height: 140,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumbnailUrl ?? photo.url}
                  alt={photo.caption ?? ""}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity duration-200" />
              </button>
            ))}
          </div>

          {/* See All button */}
          {photos.length > PREVIEW_COUNT && (
            <button
              onClick={() => setShowAll(true)}
              className="flex items-center gap-1.5 mt-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ color: "var(--portal-accent)" }}
            >
              <Images className="w-4 h-4" />
              {t("gallery.seeAll")} ({photos.length})
            </button>
          )}
        </div>
      )}

      {/* ── Expanded view: grouped by source ─────────────────────────────── */}
      {showAll && (
        <div className="space-y-5">
          {/* Collapse button */}
          <button
            onClick={() => setShowAll(false)}
            className="flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--portal-accent)" }}
          >
            <ChevronDown className="w-4 h-4 rotate-180" />
            {t("gallery.showLess")}
          </button>

          {groupedPhotos.map(([source, sourcePhotos]) => (
            <div key={source}>
              <h3
                className="text-xs font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--portal-text-tertiary)" }}
              >
                {getSourceLabel(source, t)}
              </h3>
              <div
                className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
                style={{ gap: "var(--portal-gallery-gap, 8px)" }}
              >
                {sourcePhotos.map((photo) => (
                  <button
                    key={photo.id}
                    onClick={() => openLightboxForPhoto(photo.id)}
                    className="relative overflow-hidden group aspect-square"
                    style={{
                      borderRadius: "var(--portal-gallery-item-radius, var(--portal-radius))",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbnailUrl ?? photo.url}
                      alt={photo.caption ?? ""}
                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity duration-200" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {isOpen && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.9)" }}
        >
          {/* Backdrop click to close */}
          <div className="absolute inset-0" onClick={closeLightbox} />

          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 p-2 rounded-full transition-colors"
            style={{
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
            }}
            aria-label={t("gallery.close")}
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          <div
            className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
            }}
          >
            {lightboxIndex + 1} / {flatPhotos.length}
          </div>

          {/* Previous button */}
          {flatPhotos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrevious();
              }}
              className="absolute left-4 z-10 p-2 rounded-full transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                color: "#fff",
              }}
              aria-label={t("gallery.previous")}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Image + Caption */}
          <div
            className="relative z-0 flex flex-col items-center max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={flatPhotos[lightboxIndex].url}
              alt={flatPhotos[lightboxIndex].caption ?? ""}
              className="max-h-[80vh] max-w-full object-contain"
            />
            {flatPhotos[lightboxIndex].caption && (
              <p
                className="mt-3 text-sm text-center px-4"
                style={{ color: "rgba(255,255,255,0.7)" }}
              >
                {flatPhotos[lightboxIndex].caption}
              </p>
            )}
          </div>

          {/* Next button */}
          {flatPhotos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              className="absolute right-4 z-10 p-2 rounded-full transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                color: "#fff",
              }}
              aria-label={t("gallery.next")}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
