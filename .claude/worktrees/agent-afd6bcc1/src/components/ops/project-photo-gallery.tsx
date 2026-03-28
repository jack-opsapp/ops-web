"use client";

/**
 * OPS Web - Project Photo Gallery
 *
 * Grouped photo gallery for a project, organized by source:
 *   SITE VISIT → IN PROGRESS → COMPLETION → OTHER
 *
 * Supports upload with source selector.
 * Runs one-time migration of legacy projectImages string on first load.
 */

import { useState, useEffect } from "react";
import { Camera, ChevronDown, ChevronRight, Upload, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";
import { useProjectPhotos, useCreateProjectPhoto, useDeleteProjectPhoto } from "@/lib/hooks/use-project-photos";
import { ProjectPhotoService } from "@/lib/api/services/project-photo-service";
import { uploadImage } from "@/lib/api/services";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ProjectPhoto, PhotoSource } from "@/lib/types/pipeline";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<PhotoSource, { label: string; color: string }> = {
  site_visit: { label: "Site Visit", color: "text-[#8BB8D4]" },
  in_progress: { label: "In Progress", color: "text-[#C4A868]" },
  completion: { label: "Completion", color: "text-[#9DB582]" },
  other: { label: "Other", color: "text-[#9CA3AF]" },
};

const SOURCE_ORDER: PhotoSource[] = ["site_visit", "in_progress", "completion", "other"];

// ─── Photo Lightbox ───────────────────────────────────────────────────────────

function PhotoLightbox({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/60 hover:text-white"
      >
        <X className="h-6 w-6" />
      </button>
      <div className="max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
        <img
          src={url}
          alt={caption ?? "Photo"}
          className="max-w-full max-h-[80vh] object-contain rounded-xl"
        />
        {caption && (
          <p className="text-center text-sm text-white/60 mt-3">{caption}</p>
        )}
      </div>
    </div>
  );
}

// ─── Photo Group ──────────────────────────────────────────────────────────────

function PhotoGroup({
  source,
  photos,
  onDelete,
}: {
  source: PhotoSource;
  photos: ProjectPhoto[];
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [lightbox, setLightbox] = useState<{ url: string; caption: string | null } | null>(null);
  const config = SOURCE_CONFIG[source];

  if (photos.length === 0) return null;

  const shown = expanded ? photos : photos.slice(0, 6);
  const hidden = expanded ? 0 : Math.max(0, photos.length - 6);

  return (
    <div className="rounded-xl border border-[#2A2A2A] overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#111] hover:bg-[#1A1A1A] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium", config.color)}>
            {config.label}
          </span>
          <span className="text-xs text-[#555]">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[#555]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#555]" />
        )}
      </button>

      {/* Photos grid */}
      {expanded && (
        <div className="p-3 grid grid-cols-3 gap-2">
          {shown.map((photo) => (
            <div
              key={photo.id}
              className="group relative aspect-square rounded-lg overflow-hidden bg-[#1A1A1A] cursor-pointer"
              onClick={() => setLightbox({ url: photo.url, caption: photo.caption })}
            >
              <img
                src={photo.url}
                alt={photo.caption ?? "Photo"}
                className="w-full h-full object-cover"
              />
              {/* Delete overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(photo.id);
                  }}
                  className="h-8 w-8 rounded-full bg-[#93321A]/80 flex items-center justify-center hover:bg-[#93321A] transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5 text-white" />
                </button>
              </div>
            </div>
          ))}
          {hidden > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="aspect-square rounded-lg bg-[#1A1A1A] flex items-center justify-center text-sm text-[#9CA3AF] hover:bg-[#2A2A2A] transition-colors"
            >
              +{hidden} more
            </button>
          )}
        </div>
      )}

      {lightbox && (
        <PhotoLightbox
          url={lightbox.url}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ─── Upload Button with Source Selector ───────────────────────────────────────

function UploadButton({
  projectId,
  companyId,
  userId,
  onUploaded,
}: {
  projectId: string;
  companyId: string;
  userId: string;
  onUploaded: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<PhotoSource>("in_progress");
  const createPhoto = useCreateProjectPhoto();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setShowMenu(false);
    try {
      const url = await uploadImage(file);
      await createPhoto.mutateAsync({
        projectId,
        companyId,
        url,
        thumbnailUrl: null,
        source: selectedSource,
        siteVisitId: null,
        uploadedBy: userId,
        takenAt: null,
        caption: null,
      });
      toast.success("Photo uploaded");
      onUploaded();
    } catch {
      toast.error("Failed to upload photo");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={uploading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#417394]/20 hover:bg-[#417394]/30 text-[#8BB8D4] text-sm font-medium transition-colors"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        Upload Photo
      </button>

      {showMenu && (
        <div className="absolute right-0 top-10 z-50 w-44 bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg shadow-xl py-1">
          {SOURCE_ORDER.map((source) => (
            <label
              key={source}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#2A2A2A] transition-colors"
            >
              <input
                type="radio"
                name="source"
                checked={selectedSource === source}
                onChange={() => setSelectedSource(source)}
                className="accent-[#417394]"
              />
              <span className={cn("text-sm", SOURCE_CONFIG[source].color)}>
                {SOURCE_CONFIG[source].label}
              </span>
            </label>
          ))}
          <div className="border-t border-[#2A2A2A] mt-1 pt-1 px-2 pb-1">
            <label className="block w-full text-center text-sm text-[#417394] cursor-pointer hover:text-[#4f8aae] py-1 transition-colors">
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
              Select File →
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Gallery ─────────────────────────────────────────────────────────────

export interface ProjectPhotoGalleryProps {
  projectId: string;
  /** Legacy comma-separated image URLs — migrated on first render */
  legacyImages?: string[];
}

export function ProjectPhotoGallery({ projectId, legacyImages = [] }: ProjectPhotoGalleryProps) {
  const { company, currentUser: user } = useAuthStore();
  const companyId = company?.id ?? "";
  const { data: photos = [], refetch } = useProjectPhotos(projectId);
  const deletePhoto = useDeleteProjectPhoto();

  // One-time migration of legacy projectImages
  useEffect(() => {
    if (!companyId || !user?.id || legacyImages.length === 0) return;
    ProjectPhotoService.migrateProjectImages(
      projectId,
      companyId,
      legacyImages,
      user.id
    ).then(() => refetch()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, companyId]);

  // Group by source
  const grouped = SOURCE_ORDER.reduce<Record<PhotoSource, ProjectPhoto[]>>(
    (acc, source) => {
      acc[source] = photos.filter((p) => p.source === source);
      return acc;
    },
    { site_visit: [], in_progress: [], completion: [], other: [] }
  );

  const totalCount = photos.length;

  const handleDelete = (id: string) => {
    deletePhoto.mutate({ id, projectId });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-[#9CA3AF]" />
          <h2 className="text-sm font-medium text-[#E5E5E5]">
            Photos
          </h2>
          {totalCount > 0 && (
            <span className="text-xs text-[#555]">{totalCount}</span>
          )}
        </div>
        {companyId && user?.id && (
          <UploadButton
            projectId={projectId}
            companyId={companyId}
            userId={user.id}
            onUploaded={refetch}
          />
        )}
      </div>

      {/* Groups */}
      {totalCount === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A2A] py-10 flex flex-col items-center gap-2">
          <Camera className="h-8 w-8 text-[#333]" />
          <p className="text-sm text-[#555]">No photos yet</p>
          <p className="text-xs text-[#444]">Upload site visit, in-progress, or completion photos</p>
        </div>
      ) : (
        <div className="space-y-3">
          {SOURCE_ORDER.map((source) => (
            <PhotoGroup
              key={source}
              source={source}
              photos={grouped[source]}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
