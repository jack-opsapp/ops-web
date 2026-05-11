"use client";

/**
 * FilesViewV3 — body of the FILES tab in the redesigned inbox right rail
 * (spec § 6.5).
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  [FILES] {n}   [PHOTOS] {n}                 │  ← internal toggle
 *   ├─────────────────────────────────────────────┤
 *   │  // CONTRACTS · {n}                          │  ← FILES sub-view
 *   │  { row: filename · MMM DD }                  │     (filters out
 *   │  ...                                         │     estimates+invoices —
 *   │                                              │     those moved to
 *   │                                              │     ACCOUNTING in D3)
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
import { SlashLabel } from "../voice/slash-label";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import type { Project } from "@/lib/types/models";
import { PhotosByProject } from "./photos-by-project";

type SubView = "files" | "photos";

interface FilesViewV3Props {
  /** Estimates + invoices + (eventually) other documents for the current
   *  client. Estimates/invoices are filtered OUT inside the FILES sub-view
   *  — they live in the ACCOUNTING tab now. */
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

  // FILES sub-view: anything that's NOT an estimate or invoice. Estimates
  // and invoices moved to the ACCOUNTING tab in D3 — they don't repeat
  // here. With today's data sources this list is always empty; the empty
  // state renders.
  const otherFiles = documents.filter(
    (d) => d.sourceType !== "estimate" && d.sourceType !== "invoice",
  );

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
          ? "border-border-medium bg-surface-active text-text"
          : "border-line text-text-3 hover:bg-inbox-elev",
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
    <section data-testid="files-contracts" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-0.5 pb-1">
        <SlashLabel
          label={t("rail.sectionContracts", "// CONTRACTS")}
          tone="text-2"
        />
        <span
          className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
          style={TNUM_ZERO}
        >
          {files.length}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {files.map((file) => (
          <li key={file.id}>
            <FileRow file={file} onFileOpen={onFileOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface FileRowProps {
  file: ProjectDocument;
  onFileOpen?: (file: ProjectDocument) => void;
}

function FileRow({ file, onFileOpen }: FileRowProps) {
  return (
    <button
      type="button"
      onClick={() => onFileOpen?.(file)}
      className="flex w-full items-center gap-2.5 rounded-[2.5px] border border-line bg-inbox-panel px-2.5 py-2 text-left hover:bg-inbox-elev"
    >
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase text-text-2"
        style={TNUM_ZERO}
      >
        {file.filename}
      </span>
      <span
        className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-text-mute"
        style={TNUM_ZERO}
      >
        {formatDate(file.updatedAt)}
      </span>
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}
