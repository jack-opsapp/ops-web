"use client";

/**
 * OPS Web - Photo Feed
 *
 * Instagram-style feed layout for project photos with sort and search.
 * Each photo renders as a card with uploader avatar, name, timestamp,
 * and optional caption.
 */

import { useState, useMemo } from "react";
import { Camera } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { useProjectPhotos } from "@/lib/hooks/use-project-photos";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { getUserFullName } from "@/lib/types/models";
import { useDictionary, useLocale } from "@/i18n/client";
import { UserAvatar } from "@/components/ops/user-avatar";
import { EmptyState } from "@/components/ops/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import type { User } from "@/lib/types/models";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PhotoFeedProps {
  projectId: string;
  className?: string;
}

// ─── Shimmer Skeleton ────────────────────────────────────────────────────────

function PhotoCardSkeleton() {
  return (
    <div className="bg-background-card border border-border rounded-[3px] overflow-hidden mb-4 animate-pulse">
      <div className="w-full h-[280px] bg-[rgba(255,255,255,0.04)]" />
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="h-7 w-7 rounded-full bg-[rgba(255,255,255,0.06)]" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-24 bg-[rgba(255,255,255,0.06)] rounded-sm" />
          <div className="h-2.5 w-16 bg-[rgba(255,255,255,0.04)] rounded-sm" />
        </div>
      </div>
    </div>
  );
}

// ─── Photo Card ──────────────────────────────────────────────────────────────

function PhotoCard({
  photo,
  uploader,
}: {
  photo: ProjectPhoto;
  uploader: User | undefined;
}) {
  const displayName = uploader ? getUserFullName(uploader) : "Unknown User";
  const photoDate = new Date(photo.takenAt || photo.createdAt);
  const timeAgo = formatDistanceToNow(photoDate, { addSuffix: true });

  return (
    <div className="bg-background-card border border-border rounded-[3px] overflow-hidden mb-4">
      {/* Image — click opens full size */}
      <a href={photo.url} target="_blank" rel="noopener noreferrer">
        <img
          src={photo.url}
          alt={photo.caption ?? "Project photo"}
          className="w-full max-h-[400px] object-cover"
          loading="lazy"
        />
      </a>

      {/* Footer */}
      <div className="px-4 py-3 flex items-start gap-3">
        <UserAvatar
          name={displayName}
          imageUrl={uploader?.profileImageURL ?? null}
          size="sm"
          color={uploader?.userColor ?? undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mohave text-body-sm text-text-primary font-medium truncate">
              {displayName}
            </span>
            <span className="font-mohave text-body-sm text-text-disabled shrink-0">
              {timeAgo}
            </span>
          </div>
          {photo.caption && (
            <p className="font-mohave text-body-sm text-text-secondary mt-0.5 line-clamp-3">
              {photo.caption}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PhotoFeed({ projectId, className }: PhotoFeedProps) {
  const { data: photos, isLoading } = useProjectPhotos(projectId);
  const { data: teamData } = useTeamMembers();
  const { t } = useDictionary("projects");
  useLocale(); // i18n context — triggers re-render on locale change

  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [searchQuery, setSearchQuery] = useState("");

  // Build a lookup map: userId → User
  const userMap = useMemo(() => {
    const map = new Map<string, User>();
    if (teamData?.users) {
      for (const user of teamData.users) {
        map.set(user.id, user);
      }
    }
    return map;
  }, [teamData?.users]);

  // Filter by caption search, then sort by date
  const filteredPhotos = useMemo(() => {
    let result = [...(photos ?? [])];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) =>
        (p.caption || "").toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const dateA = new Date(a.takenAt || a.createdAt).getTime();
      const dateB = new Date(b.takenAt || b.createdAt).getTime();
      return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [photos, searchQuery, sortOrder]);

  // ── Loading state ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={cn(className)}>
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-[160px] bg-[rgba(255,255,255,0.04)] rounded-sm animate-pulse" />
          <div className="h-7 w-[200px] bg-[rgba(255,255,255,0.04)] rounded-sm animate-pulse" />
        </div>
        <PhotoCardSkeleton />
        <PhotoCardSkeleton />
        <PhotoCardSkeleton />
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!photos || photos.length === 0) {
    return (
      <div className={cn(className)}>
        <EmptyState
          icon={<Camera className="h-4 w-4" />}
          title={t("photoFeed.noPhotos")}
          description={t("photoFeed.noPhotosDesc")}
        />
      </div>
    );
  }

  // ── Feed ───────────────────────────────────────────────────────────────────

  return (
    <div className={cn(className)}>
      {/* Toolbar: sort + search */}
      <div className="flex items-center justify-between mb-4">
        <Select
          value={sortOrder}
          onValueChange={(v) => setSortOrder(v as "newest" | "oldest")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">
              {t("photoFeed.sortNewest")}
            </SelectItem>
            <SelectItem value="oldest">
              {t("photoFeed.sortOldest")}
            </SelectItem>
          </SelectContent>
        </Select>

        <input
          type="text"
          placeholder={t("photoFeed.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="font-mohave text-body-sm bg-background-card border border-border rounded-[3px] px-3 py-1.5 text-text-primary placeholder:text-text-disabled w-[200px] outline-none focus:border-[rgba(255,255,255,0.3)]"
        />
      </div>

      {/* Photo cards */}
      {filteredPhotos.length === 0 ? (
        <EmptyState
          icon={<Camera className="h-4 w-4" />}
          title={t("photoFeed.noPhotos")}
          description={t("photoFeed.noPhotosDesc")}
        />
      ) : (
        filteredPhotos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            uploader={userMap.get(photo.uploadedBy)}
          />
        ))
      )}
    </div>
  );
}
