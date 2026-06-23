"use client";

import { File, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface PhotoItem {
  id: string;
  url: string;
  filename: string;
}

export type FileKind = "pdf" | "doc" | "spreadsheet" | "image" | "other";

export interface FileItem {
  id: string;
  filename: string;
  /** Bytes. Optional — unset when the source doesn't track file size
   *  (e.g. server-rendered estimate/invoice PDFs). When omitted, the
   *  metadata line drops the size segment entirely. */
  size?: number;
  kind: FileKind;
  /** ISO date. Rendered as "MAR 14". */
  updatedAt: string;
  /** Optional deep-link target. When set, clicking the file navigates
   *  here in addition to firing onFileOpen. */
  href?: string;
  /** Optional short status label rendered under the filename — e.g.
   *  "PAID" / "DRAFT" for invoices. Cake-mono uppercase, sentence-case
   *  values get UPPERCASED by the component. */
  status?: string | null;
}

interface FilesViewProps {
  photos: PhotoItem[];
  documents: FileItem[];
  onPhotoOpen?: (photo: PhotoItem) => void;
  onFileOpen?: (file: FileItem) => void;
  className?: string;
}

const KIND_ICON = {
  pdf: FileText,
  doc: FileText,
  spreadsheet: FileSpreadsheet,
  image: FileImage,
  other: File,
} as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export function FilesView({
  photos,
  documents,
  onPhotoOpen,
  onFileOpen,
  className,
}: FilesViewProps) {
  const { t } = useDictionary("inbox");
  const empty = photos.length === 0 && documents.length === 0;

  if (empty) {
    return (
      <p className={cn("font-mohave text-[12px] text-text-3", className)}>
        {t("files.empty", "no files attached")}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {photos.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
            {t("files.imagesLabel", "Images · {count}").replace(
              "{count}",
              String(photos.length),
            )}
          </h4>
          <div data-testid="files-photo-grid" className="grid grid-cols-3 gap-1">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                title={photo.filename}
                aria-label={t("files.openPhoto", "Open photo {filename}").replace(
                  "{filename}",
                  photo.filename,
                )}
                onClick={() => onPhotoOpen?.(photo)}
                className="relative aspect-square overflow-hidden rounded-chip border border-line bg-transparent transition-transform hover:scale-[1.01]"
              >
                <img
                  src={photo.url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span
                  className="absolute inset-x-1.5 bottom-1.5 truncate rounded-bar border border-line bg-transparent px-1 font-mono text-[11px] tracking-[0.3em] text-text-2"
                  style={{
                    fontFeatureSettings: '"tnum" 1, "zero" 1',
                  }}
                >
                  {photo.filename.replace(/\.[^.]+$/, "")}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {documents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
            {t("files.documentsLabel", "Documents · {count}").replace(
              "{count}",
              String(documents.length),
            )}
          </h4>
          <ul className="flex flex-col gap-1.5">
            {documents.map((doc) => {
              const Icon = KIND_ICON[doc.kind];
              const sizeSegment =
                typeof doc.size === "number" ? formatSize(doc.size) : null;
              const dateSegment = formatDate(doc.updatedAt);
              const meta = sizeSegment
                ? `${sizeSegment} · ${dateSegment}`
                : dateSegment;
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => onFileOpen?.(doc)}
                    className="flex w-full items-center gap-2.5 rounded-sm border border-line bg-transparent px-2.5 py-2 text-left hover:border-line-hi"
                  >
                    <span className="flex h-6 w-[24px] shrink-0 items-center justify-center rounded-chip border border-line bg-transparent">
                      <Icon
                        aria-hidden
                        className="h-3.5 w-3.5 text-text-3"
                        strokeWidth={1.5}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-mohave text-[12px] text-text-2">
                        {doc.filename}
                      </span>
                      {doc.status && (
                        <span className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.18em] text-text-3">
                          {doc.status}
                        </span>
                      )}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[11px] tabular-nums uppercase tracking-[0.18em] text-text-mute"
                      style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
                    >
                      {meta}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
