"use client";

import Image from "next/image";
import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDictionary } from "@/i18n/client";
import { useCellPhotoUpload } from "@/lib/hooks/projects-table/use-cell-photo-upload";
import type { ProjectTablePhoto } from "@/lib/api/services/project-table-photo-service";
import type { ProjectTableRow } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";

const ISOLATED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  " ",
]);

const IMAGE_INPUT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

function formatText(template: string, replacements?: Record<string, string | number>) {
  if (!replacements) return template;
  return Object.entries(replacements).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
    template,
  );
}

function stopTableKeys(event: KeyboardEvent<HTMLElement>, onEscape?: () => void) {
  if (!ISOLATED_KEYS.has(event.key)) return;
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape?.();
  }
}

function stopPointer(event: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function photoSrc(photo: ProjectTablePhoto) {
  return photo.thumbnailUrl || photo.url;
}

export function CellPhotos({ row }: { row: ProjectTableRow }) {
  const { t } = useDictionary("projects");
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectButtonRef = useRef<HTMLButtonElement | null>(null);

  const { photosQuery, photos, uploadPhoto, deletePhoto } = useCellPhotoUpload({
    row,
    enabled: open,
  });
  const uploadFailedMessage = t("table.cell.photos.uploadFailed");
  const deleteFailedMessage = t("table.cell.photos.deleteFailed");
  const displayCount = photosQuery.isSuccess ? photos.length : row.photoCount;
  const title = formatText(t("table.cell.photos.title"), { project: row.title });
  const triggerLabel = formatText(t("table.cell.photos.triggerLabel"), {
    project: row.title,
    count: displayCount,
  });
  const visibleFeedback = feedback ?? (photosQuery.isError ? uploadFailedMessage : null);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setFeedback(null);
      setDragActive(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setFeedback(null);

    for (const file of files) {
      try {
        await uploadPhoto.mutateAsync(file);
      } catch {
        setFeedback(uploadFailedMessage);
        return;
      }
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function handleDelete(photoId: string) {
    setFeedback(null);
    try {
      await deletePhoto.mutateAsync(photoId);
    } catch {
      setFeedback(deleteFailedMessage);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          onClick={stopPointer}
          onKeyDown={(event) => stopTableKeys(event)}
          className="flex h-full w-full min-w-0 items-center justify-end gap-1 rounded px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
          <span className="font-mono text-micro tabular-nums text-text-2">{displayCount}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        role="dialog"
        aria-label={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectButtonRef.current?.focus();
        }}
        onPointerDown={stopPointer}
        onClick={stopPointer}
        onKeyDown={(event) => stopTableKeys(event, () => handleOpenChange(false))}
        className="z-[1000] w-[min(380px,calc(100vw-32px))] rounded-modal border border-border p-0"
      >
        <div className="flex max-h-[min(520px,calc(100vh-96px))] min-h-[300px] flex-col overflow-hidden">
          <div className="border-b border-border px-3 py-3">
            <p className="font-mono text-micro uppercase tracking-wider text-text">{title}</p>
            <p className="mt-1 font-mono text-micro tabular-nums text-text-3">
              {displayCount}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {visibleFeedback ? (
              <p className="mb-3 rounded border border-border bg-surface-input px-2 py-1.5 font-mono text-micro uppercase tracking-wider text-rose">
                {visibleFeedback}
              </p>
            ) : null}

            <div className="grid grid-cols-[repeat(auto-fill,68px)] gap-1">
              {photos.length > 0 ? (
                photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className="group relative h-[68px] w-[68px] overflow-hidden rounded border border-border bg-surface-input"
                  >
                    <Image
                      src={photoSrc(photo)}
                      alt={formatText(t("table.cell.photos.thumbnail"), { index: index + 1 })}
                      width={68}
                      height={68}
                      className="h-[68px] w-[68px] object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t("table.cell.photos.delete")}
                      disabled={deletePhoto.isPending}
                      onClick={() => {
                        void handleDelete(photo.id);
                      }}
                      className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-background/80 text-text-2 opacity-0 outline-none transition-colors hover:bg-surface-active hover:text-rose focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="flex h-[68px] w-[68px] items-center justify-center rounded border border-border bg-surface-input font-mono text-micro text-text-3">
                  {t("table.cell.photos.empty")}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border px-3 py-3">
            <label
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={cn(
                "flex min-h-[84px] cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-surface-input px-3 py-2 text-center transition-colors hover:bg-surface-hover",
                dragActive && "border-border-medium bg-surface-active",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                aria-label={t("table.cell.photos.select")}
                accept={IMAGE_INPUT_ACCEPT}
                multiple
                onChange={handleFileChange}
                className="sr-only"
              />
              <Upload className="h-4 w-4 text-text-3" strokeWidth={1.5} aria-hidden="true" />
              <span className="font-mono text-micro uppercase tracking-wider text-text-2">
                {t("table.cell.photos.drop")}
              </span>
            </label>

            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                ref={selectButtonRef}
                type="button"
                disabled={uploadPhoto.isPending}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 items-center justify-center gap-1 rounded border border-border px-3 font-mohave text-button-sm uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                {t("table.cell.photos.select")}
              </button>

              {uploadPhoto.isPending ? (
                <span className="inline-flex items-center gap-1 font-mono text-micro uppercase tracking-wider text-text-3">
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" strokeWidth={1.5} aria-hidden="true" />
                  {t("table.cell.photos.uploading")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
