"use client";

/* eslint-disable @next/next/no-img-element -- Pipeline photos use arbitrary signed/provider URLs outside the Next image allowlist. */

/**
 * PHOTOS tab — every photo attached to the lead, one surface:
 *
 *   1. Lead photos (`opportunities.images`) — first-class, first in the grid.
 *      Crew-captured on iOS or added right here; the only removable kind.
 *      Add/remove ride the presign flow + server-state read-modify-write
 *      (bible 03 § Images contract) so concurrent producers never clobber.
 *   2. Email attachment images (activities) — provenance-labelled, read-only.
 *   3. Site-visit photos — provenance-labelled, read-only.
 *
 * The ADD tile lives inside the grid (the affordance sits where the result
 * lands) and doubles as the managed empty state.
 */

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { Camera, Loader2, Plus, X } from "lucide-react";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import type { Locale } from "@/i18n/types";
import {
  type Activity,
  ActivityType,
  type Opportunity,
} from "@/lib/types/pipeline";
import {
  useOpportunityActivities,
  useSiteVisits,
  useAddOpportunityImages,
  useRemoveOpportunityImage,
} from "@/lib/hooks";
import { uploadLeadPhotos } from "@/lib/api/services/lead-photo-upload";
import type { OpportunityAssignedContextIntakeAttachment } from "@/lib/api/services/opportunity-assigned-context-service";

// ── Utilities ──

const IMG_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i;

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/heic";

interface PhotoRecord {
  url: string;
  source: string;
  /** Lead photos (`opportunities.images`) are the only removable kind. */
  removable: boolean;
}

function collectPhotos(
  leadImages: string[],
  activities: Activity[],
  siteVisits: Array<{ photos: string[]; scheduledAt: Date | string }>,
  intakeAttachments: OpportunityAssignedContextIntakeAttachment[],
  locale: Locale,
  t: (key: string, fallback?: string) => string
): PhotoRecord[] {
  const photos: PhotoRecord[] = [];

  // Lead photos lead, in stored order (producers append newest last).
  for (const url of leadImages) {
    if (!url) continue;
    photos.push({
      url,
      source: t("detail.photoLeadSource", "Photo"),
      removable: true,
    });
  }

  const dated: Array<PhotoRecord & { date: Date }> = [];

  for (const a of activities) {
    if (a.type !== ActivityType.Email) continue;
    for (const url of a.attachments) {
      if (IMG_RE.test(url)) {
        const d = new Date(a.createdAt);
        dated.push({
          url,
          date: d,
          source: `${t("detail.photoEmailSource", "Email")} — ${d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" })}`,
          removable: false,
        });
      }
    }
  }

  for (const sv of siteVisits) {
    for (const url of sv.photos) {
      const d = new Date(sv.scheduledAt);
      dated.push({
        url,
        date: d,
        source: `${t("detail.photoSiteVisitSource", "Site visit")} — ${d.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" })}`,
        removable: false,
      });
    }
  }

  for (const attachment of intakeAttachments) {
    if (attachment.kind !== "image" || !attachment.previewUrl) continue;
    const date = new Date(attachment.occurredAt);
    dated.push({
      url: attachment.previewUrl,
      date,
      source: `${t("detail.photoWebsiteSource", "Website")} — ${date.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" })}`,
      removable: false,
    });
  }

  dated.sort((a, b) => b.date.getTime() - a.date.getTime());
  photos.push(...dated);
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
  const { t } = useDictionary("pipeline");
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && activeIndex > 0) onNavigate(activeIndex - 1);
      if (e.key === "ArrowRight" && activeIndex < photos.length - 1)
        onNavigate(activeIndex + 1);
      if (e.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
          ) ?? []
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (focusable.length === 1) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeIndex, photos.length, onClose, onNavigate]);

  return (
    <div
      ref={dialogRef}
      data-pipeline-detail-modal=""
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.photoViewer", "Photo viewer")}
      className="z-modal fixed inset-0 flex items-center justify-center bg-background/80 p-10"
      onClick={onClose}
    >
      <button
        type="button"
        autoFocus
        aria-label={t("detail.photoClose", "Close photo")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded border border-border bg-fill-neutral-dim text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-active hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent motion-reduce:transition-none"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {/* Left arrow */}
      {activeIndex > 0 && (
        <button
          type="button"
          aria-label={t("detail.photoPrevious", "Previous photo")}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(activeIndex - 1);
          }}
          className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded border border-border bg-fill-neutral-dim text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-active hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent motion-reduce:transition-none"
        >
          <span className="font-mono text-body-sm">&lsaquo;</span>
        </button>
      )}

      <img
        src={photos[activeIndex].url}
        alt={photos[activeIndex].source}
        className="max-h-full max-w-full rounded-chip object-contain"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Right arrow */}
      {activeIndex < photos.length - 1 && (
        <button
          type="button"
          aria-label={t("detail.photoNext", "Next photo")}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(activeIndex + 1);
          }}
          className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded border border-border bg-fill-neutral-dim text-text-2 transition-colors duration-150 ease-smooth hover:bg-surface-active hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent motion-reduce:transition-none"
        >
          <span className="font-mono text-body-sm">&rsaquo;</span>
        </button>
      )}

      {/* Counter */}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-micro text-text-2">
        {activeIndex + 1} / {photos.length}
      </span>
    </div>
  );
}

// ── Add tile ──

function AddPhotoTile({
  uploading,
  progress,
  onFiles,
  label,
  ariaLabel,
}: {
  uploading: boolean;
  progress: { done: number; total: number } | null;
  onFiles: (files: File[]) => void;
  label: string;
  ariaLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <label
      className={
        "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-border text-text-3 transition-colors duration-150 ease-smooth focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ops-accent hover:border-border-medium hover:bg-surface-hover hover:text-text-2 motion-reduce:transition-none" +
        (uploading ? " pointer-events-none" : "")
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        className="sr-only"
        disabled={uploading}
        aria-label={ariaLabel}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      {uploading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {progress && (
            <span className="font-mono text-micro slashed-zero tabular-nums">
              {progress.done}/{progress.total}
            </span>
          )}
        </>
      ) : (
        <>
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          <span className="font-mono text-micro uppercase tracking-widest">
            {label}
          </span>
        </>
      )}
    </label>
  );
}

// ── Exported tab ──

interface PipelineDetailPhotosTabProps {
  opportunity: Opportunity;
  canManage: boolean;
  intakeAttachments?: OpportunityAssignedContextIntakeAttachment[];
}

export function PipelineDetailPhotosTab({
  opportunity,
  canManage,
  intakeAttachments = [],
}: PipelineDetailPhotosTabProps) {
  const { t } = useDictionary("pipeline");
  const { locale } = useLocale();
  const { data: activities } = useOpportunityActivities(opportunity.id);
  const { data: siteVisits } = useSiteVisits({ opportunityId: opportunity.id });
  const addImages = useAddOpportunityImages();
  const removeImage = useRemoveOpportunityImage();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingUrl, setRemovingUrl] = useState<string | null>(null);
  const lightboxTriggerRef = useRef<HTMLButtonElement | null>(null);

  const photos = useMemo(
    () =>
      collectPhotos(
        opportunity.images,
        activities ?? [],
        siteVisits ?? [],
        intakeAttachments,
        locale,
        t
      ),
    [opportunity.images, activities, siteVisits, intakeAttachments, locale, t]
  );

  const handleNavigate = useCallback((idx: number) => {
    setLightboxIndex(idx);
  }, []);

  const handleLightboxClose = useCallback(() => {
    setLightboxIndex(null);
    lightboxTriggerRef.current?.focus();
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setUploadError(null);
      setUploading(true);
      setProgress({ done: 0, total: files.length });
      try {
        const { urls, failedCount } = await uploadLeadPhotos(
          files,
          opportunity.companyId,
          opportunity.id,
          (done, total) => setProgress({ done, total })
        );

        if (urls.length > 0) {
          await addImages.mutateAsync({ id: opportunity.id, urls });
        }

        if (failedCount > 0) {
          setUploadError(
            urls.length > 0
              ? t("detail.photoUploadPartial", "Some photos didn't upload")
              : t("detail.photoUploadFailed", "Upload failed")
          );
        }
      } catch {
        setUploadError(t("detail.photoUploadFailed", "Upload failed"));
      } finally {
        setUploading(false);
        setProgress(null);
      }
    },
    [addImages, opportunity.companyId, opportunity.id, t]
  );

  const handleRemove = useCallback(
    (url: string) => {
      setRemovingUrl(url);
      removeImage.mutate(
        { id: opportunity.id, url },
        {
          onError: () =>
            setUploadError(
              t("detail.photoRemoveFailed", "Failed to remove photo")
            ),
          onSettled: () => setRemovingUrl(null),
        }
      );
    },
    [opportunity.id, removeImage, t]
  );

  if (photos.length === 0 && !canManage) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Camera className="mb-2 h-5 w-5 text-text-mute" />
        <span className="font-mono text-micro text-text-mute">
          {t("detail.noPhotosYet")}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-1">
        {canManage && (
          <AddPhotoTile
            uploading={uploading}
            progress={progress}
            onFiles={handleFiles}
            label={t("detail.addPhotosShort", "Add")}
            ariaLabel={t("detail.addPhotos", "Add photos")}
          />
        )}

        {photos.map((photo, idx) => {
          const removing = removingUrl === photo.url;
          return (
            <div
              key={`${photo.url}-${idx}`}
              className={
                "group relative aspect-square" + (removing ? " opacity-50" : "")
              }
            >
              <button
                type="button"
                aria-label={`${t("detail.photoOpen", "Open photo")} — ${photo.source}`}
                onClick={(event) => {
                  lightboxTriggerRef.current = event.currentTarget;
                  setLightboxIndex(idx);
                }}
                disabled={removing}
                className="h-full w-full overflow-hidden rounded-panel border border-border transition-colors duration-150 ease-smooth hover:border-border-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent motion-reduce:transition-none"
              >
                <img
                  src={photo.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 flex h-6 items-end justify-center bg-gradient-to-t from-background/60 to-transparent pb-0.5 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 motion-reduce:transition-none">
                  <span className="font-mono text-micro text-text-2">
                    {photo.source}
                  </span>
                </div>
              </button>

              {photo.removable && canManage && (
                <button
                  type="button"
                  aria-label={t("detail.removePhoto", "Remove photo")}
                  disabled={removing}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(photo.url);
                  }}
                  className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded bg-background/70 text-text-2 opacity-0 transition-[opacity,color] duration-150 ease-smooth hover:text-rose focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ops-accent group-hover:opacity-100 motion-reduce:transition-none"
                >
                  <X className="h-3 w-3" strokeWidth={1.75} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {uploadError && (
        <p className="mt-2 font-mono text-micro uppercase tracking-widest">
          <span className="text-text-mute">{"// "}</span>
          <span className="text-rose">{uploadError}</span>
        </p>
      )}

      {lightboxIndex !== null && photos[lightboxIndex] && (
        <PhotoLightbox
          photos={photos}
          activeIndex={lightboxIndex}
          onClose={handleLightboxClose}
          onNavigate={handleNavigate}
        />
      )}
    </>
  );
}
