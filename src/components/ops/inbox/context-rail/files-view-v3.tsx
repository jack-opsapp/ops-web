"use client";

/**
 * FilesViewV3 — body of the FILES tab in the redesigned inbox right rail
 * (spec § 6.5).
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  [FILES] {n}   [PHOTOS] {n}                 │  ← internal toggle
 *   ├─────────────────────────────────────────────┤
 *   │  { row: filename · type/source · size · date } ← FILES sub-view
 *   │  ...                                         │    (filters out
 *   │                                              │    estimates+invoices —
 *   │                                              │    those are ACCOUNTING)
 *   ├─────────────────────────────────────────────┤
 *   │  // {PROJECT NAME} · {n} PHOTOS              │  ← PHOTOS sub-view
 *   │  [thumb][thumb][thumb]                       │     grouped by project
 *   │  // THIS THREAD · {n} PHOTOS                 │     + trailing bucket
 *   │  [thumb][thumb][thumb]                       │     for thread-only
 *   │  [—] not assigned to a project               │     attachments
 *   └─────────────────────────────────────────────┘
 *
 * The v2 `<FilesView>` is left in place; this component supersedes it but
 * the old file stays for one cycle in case any non-inbox surface still
 * imports it. The inbox's own mount switches over inside `inbox-route.tsx`.
 */

import { useState } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import type { Project } from "@/lib/types/models";
import { PhotosByProject } from "./photos-by-project";

type SubView = "files" | "photos";

interface FilesViewV3Props {
  /** Estimates + invoices + (eventually) other documents for the current
   *  client. Estimates/invoices are filtered OUT inside the FILES sub-view
   *  because ACCOUNTING owns financial documents. */
  documents: ProjectDocument[];
  /** Project photos for every project belonging to the current client. */
  photos: ProjectPhoto[];
  /** Image attachments on the current thread's activities that aren't
   *  assigned to a project. Renders as a final // THIS THREAD section. */
  threadOnlyPhotos: ProjectPhoto[];
  /** Projects belonging to the current client — used to label per-project
   *  photo sections. */
  projects: Project[];
  onPhotoOpen?: (photo: ProjectPhoto) => void;
  onFileOpen?: (file: ProjectDocument) => void;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

export function FilesViewV3({
  documents,
  photos,
  threadOnlyPhotos,
  projects,
  onPhotoOpen,
  onFileOpen,
  className,
}: FilesViewV3Props) {
  const [view, setView] = useState<SubView>("files");
  const { t } = useDictionary("inbox");

  // FILES sub-view: anything that's NOT an estimate or invoice. Financial
  // docs stay in ACCOUNTING; thread attachments and future non-financial
  // project/client files stay here.
  const otherFiles = documents.filter((d) => !isFinancialDocument(d));

  const filesCount = otherFiles.length;
  const photosCount = photos.length + threadOnlyPhotos.length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2 px-1 pb-3">
        <TogglePill
          active={view === "files"}
          label={t("rail.filesToggleFiles", "[FILES]")}
          count={filesCount}
          onClick={() => setView("files")}
          testId="files-toggle-files"
        />
        <TogglePill
          active={view === "photos"}
          label={t("rail.filesTogglePhotos", "[PHOTOS]")}
          count={photosCount}
          onClick={() => setView("photos")}
          testId="files-toggle-photos"
        />
      </div>

      {view === "files" ? (
        <FilesSubView
          files={otherFiles}
          onFileOpen={onFileOpen}
        />
      ) : (
        <PhotosByProject
          photos={photos}
          threadOnlyPhotos={threadOnlyPhotos}
          projects={projects}
          onPhotoOpen={onPhotoOpen}
        />
      )}
    </div>
  );
}

// ─── Toggle pill ────────────────────────────────────────────────────────────

interface TogglePillProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  testId?: string;
}

function TogglePill({ active, label, count, onClick, testId }: TogglePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-[4px] border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        active
          ? "border-border-medium bg-transparent text-text"
          : "border-line text-text-3 hover:border-line-hi hover:text-text",
      )}
      style={TNUM_ZERO}
    >
      <span>{label}</span>
      <span
        className={cn(active ? "text-text-2" : "text-text-mute")}
        style={TNUM_ZERO}
      >
        {count}
      </span>
    </button>
  );
}

// ─── FILES sub-view ─────────────────────────────────────────────────────────

interface FilesSubViewProps {
  files: ProjectDocument[];
  onFileOpen?: (file: ProjectDocument) => void;
}

function FilesSubView({ files, onFileOpen }: FilesSubViewProps) {
  const { t } = useDictionary("inbox");

  if (files.length === 0) {
    return (
      <p
        data-testid="files-empty"
        className="font-mono text-[11px] text-text-3"
      >
        {t("rail.emptyFiles", "[—] no other files attached")}
      </p>
    );
  }

  return (
    <ul data-testid="files-list" className="border-y border-line/70">
      {files.map((file) => (
        <li key={file.id} className="border-b border-line/60 last:border-b-0">
          <FileRow file={file} onFileOpen={onFileOpen} t={t} />
        </li>
      ))}
    </ul>
  );
}

interface FileRowProps {
  file: ProjectDocument;
  onFileOpen?: (file: ProjectDocument) => void;
  t: (key: string, fallback: string) => string;
}

function FileRow({ file, onFileOpen, t }: FileRowProps) {
  const metaSegments = fileMetaSegments(file, t);

  return (
    <button
      type="button"
      data-testid={`files-row-${file.id}`}
      onClick={() => onFileOpen?.(file)}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-1.5 py-2 text-left transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      <span
        className="min-w-0 truncate font-mohave text-[12px] font-medium text-text-2"
      >
        {file.filename}
      </span>
      <span
        className="justify-self-end font-mono text-[11px] uppercase tracking-[0.02em] text-text-mute"
        style={TNUM_ZERO}
      >
        {formatDate(file.updatedAt)}
      </span>
      <span
        className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] uppercase text-text-mute"
        style={TNUM_ZERO}
      >
        {metaSegments.map((segment, index) => (
          <span key={`${file.id}-${segment}-${index}`} className="inline-flex">
            {index > 0 && <span className="pr-1.5 text-text-mute">·</span>}
            {segment}
          </span>
        ))}
      </span>
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isFinancialDocument(file: ProjectDocument): boolean {
  return file.sourceType === "estimate" || file.sourceType === "invoice";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function fileMetaSegments(
  file: ProjectDocument,
  t: (key: string, fallback: string) => string,
): string[] {
  return [
    fileTypeLabel(file, t),
    fileSourceLabel(file, t),
    formatSize(file.sizeBytes),
  ].filter((segment): segment is string => segment !== null);
}

function fileTypeLabel(
  file: ProjectDocument,
  t: (key: string, fallback: string) => string,
): string {
  const fromMime = file.mimeType?.split("/").at(1)?.trim();
  const fromName = file.filename.match(/\.([^.]+)$/)?.[1]?.trim();
  const raw = fromMime ?? fromName;
  if (!raw) return t("rail.fileTypeUnknown", "FILE");

  const normalized = raw
    .replace(/^vnd\./i, "")
    .replace(/^openxmlformats-officedocument\./i, "")
    .replace(/^spreadsheetml\.sheet$/i, "xlsx")
    .replace(/^wordprocessingml\.document$/i, "docx")
    .replace(/^plain$/i, "txt")
    .replace(/^jpeg$/i, "jpg")
    .toUpperCase();

  if (normalized.includes("PDF")) return "PDF";
  if (normalized.includes("CSV")) return "CSV";
  if (normalized.includes("EXCEL")) return "XLS";
  return normalized.slice(0, 8) || t("rail.fileTypeUnknown", "FILE");
}

function fileSourceLabel(
  file: ProjectDocument,
  t: (key: string, fallback: string) => string,
): string {
  const raw = file.sourceLabel?.trim().toLowerCase();
  if (raw === "email" || file.sourceType === "email_attachment") {
    return t("rail.fileSourceEmail", "EMAIL");
  }
  if (raw) return raw.toUpperCase();
  return t("rail.fileSourceFile", "FILE");
}

function formatSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  const rounded = mb >= 10 ? Math.round(mb).toString() : mb.toFixed(1);
  return `${rounded.replace(/\.0$/, "")} MB`;
}
