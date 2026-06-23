"use client";

/**
 * PhotosByProject — body of the FILES tab's [PHOTOS] sub-view (spec § 6.5).
 *
 * Groups project photos by `projectId` and renders one section per project:
 *
 *   // {PROJECT NAME UPPERCASE} · {n} PHOTOS
 *   { 3-col thumb grid }
 *
 * Photos whose project_id matches no known project still get a section under
 * a "// {UNKNOWN PROJECT} · {n} PHOTOS" header — defensive; in practice the
 * caller passes the same projects list used to fetch the photos so every id
 * is resolvable.
 *
 * Trailing section is // THIS THREAD · {n} PHOTOS, populated from the
 * separately-typed `threadOnlyPhotos` prop. These are activity attachments
 * tied to the current thread but not associated with any project. The
 * data source isn't populated yet (see useClientFiles) — the section is
 * structurally inert in production today.
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import type { Project } from "@/lib/types/models";

interface PhotosByProjectProps {
  /** Photos with a known project_id — grouped under per-project headers. */
  photos: ProjectPhoto[];
  /** Image attachments on the current thread's activities NOT tied to a
   *  project. Rendered under a trailing // THIS THREAD section. */
  threadOnlyPhotos: ProjectPhoto[];
  /** Projects belonging to the current client — used to resolve project
   *  names for the section headers. */
  projects: Project[];
  /** Fired when a thumb is clicked. Caller wires this to a lightbox. */
  onPhotoOpen?: (photo: ProjectPhoto) => void;
  className?: string;
}

const TNUM_ZERO = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

export function PhotosByProject({
  photos,
  threadOnlyPhotos,
  projects,
  onPhotoOpen,
  className,
}: PhotosByProjectProps) {
  const { t } = useDictionary("inbox");

  // Group photos by project_id, preserving first-occurrence order for
  // stable rendering across re-renders.
  const groups = new Map<string, ProjectPhoto[]>();
  for (const p of photos) {
    const list = groups.get(p.projectId) ?? [];
    list.push(p);
    groups.set(p.projectId, list);
  }

  const projectsById = new Map(projects.map((p) => [p.id, p]));

  const everythingEmpty = photos.length === 0 && threadOnlyPhotos.length === 0;
  if (everythingEmpty) {
    return (
      <p className={cn("font-mono text-[11px] text-text-3", className)}>
        {t("rail.emptyPhotos", "[—] no photos attached")}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {Array.from(groups.entries()).map(([projectId, projectPhotos]) => {
        const project = projectsById.get(projectId);
        const name = (project?.title ?? "Unknown project").toUpperCase();
        return (
          <ProjectGroup
            key={projectId}
            testId={`photos-group-${projectId}`}
            label={`// ${name}`}
            count={projectPhotos.length}
            countLabel={t("rail.photosCount", "{n} PHOTOS").replace(
              "{n}",
              String(projectPhotos.length),
            )}
            photos={projectPhotos}
            onPhotoOpen={onPhotoOpen}
          />
        );
      })}

      {threadOnlyPhotos.length > 0 && (
        <ProjectGroup
          testId="photos-group-this-thread"
          label={t("rail.sectionThisThread", "// THIS THREAD")}
          count={threadOnlyPhotos.length}
          countLabel={t("rail.photosCount", "{n} PHOTOS").replace(
            "{n}",
            String(threadOnlyPhotos.length),
          )}
          photos={threadOnlyPhotos}
          onPhotoOpen={onPhotoOpen}
          footnote={t("rail.emptyUnassigned", "[—] not assigned to a project")}
        />
      )}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

interface ProjectGroupProps {
  label: string;
  count: number;
  countLabel: string;
  photos: ProjectPhoto[];
  onPhotoOpen?: (photo: ProjectPhoto) => void;
  footnote?: string;
  testId?: string;
}

function ProjectGroup({
  label,
  count,
  countLabel,
  photos,
  onPhotoOpen,
  footnote,
  testId,
}: ProjectGroupProps) {
  return (
    <section data-testid={testId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-0.5">
        <h4 className="font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.14em] text-text-3">
          {label} · {countLabel}
        </h4>
        <span
          className="font-mono text-[11px] tracking-[0.18em] text-text-mute"
          style={TNUM_ZERO}
        >
          {count}
        </span>
      </div>
      <div
        data-testid={testId ? `${testId}-grid` : undefined}
        className="grid grid-cols-3 gap-1"
      >
        {photos.map((photo) => (
          <PhotoThumb key={photo.id} photo={photo} onPhotoOpen={onPhotoOpen} />
        ))}
      </div>
      {footnote && (
        <p className="px-0.5 font-mono text-[11px] text-text-mute">{footnote}</p>
      )}
    </section>
  );
}

// ─── Thumb ──────────────────────────────────────────────────────────────────

interface PhotoThumbProps {
  photo: ProjectPhoto;
  onPhotoOpen?: (photo: ProjectPhoto) => void;
}

function PhotoThumb({ photo, onPhotoOpen }: PhotoThumbProps) {
  const url = photo.thumbnailUrl ?? photo.url;
  const caption = photo.caption ?? "Photo";
  return (
    <button
      type="button"
      title={caption}
      aria-label={`Open photo ${caption}`}
      onClick={() => onPhotoOpen?.(photo)}
      className="relative aspect-square overflow-hidden rounded-chip border border-line bg-transparent transition-transform hover:scale-[1.01]"
    >
      <img
        src={url}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
    </button>
  );
}
