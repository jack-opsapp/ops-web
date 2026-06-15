"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, Star, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { OpportunityViewDefinition } from "@/lib/types/pipeline-table";

/**
 * OPS Web — Pipeline saved-view tab strip.
 *
 * Mirrors `projects-table/projects-view-tabs.tsx` (project → opportunity) and
 * layers in a favorites affordance the task requires: a single starred view is
 * pinned to the front of the strip and persisted to localStorage under
 * {@link PIPELINE_FAVORITE_VIEW_STORAGE_KEY}. The star toggle, the active
 * highlight, the inline archive (X) for user-owned non-default views, and the
 * "+ New view" button all live here. The strip never uses the accent except on
 * focus rings (design system: accent is reserved for focus + the single
 * primary CTA, which is not this surface).
 */

export const PIPELINE_FAVORITE_VIEW_STORAGE_KEY = "ops_pipeline_table_favorite_view_id";

function readStoredFavoriteId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PIPELINE_FAVORITE_VIEW_STORAGE_KEY);
}

function writeStoredFavoriteId(viewId: string | null) {
  if (typeof window === "undefined") return;
  if (viewId) window.localStorage.setItem(PIPELINE_FAVORITE_VIEW_STORAGE_KEY, viewId);
  else window.localStorage.removeItem(PIPELINE_FAVORITE_VIEW_STORAGE_KEY);
}

export function PipelineViewTabs({
  views,
  activeViewId,
  onViewChange,
  onCreateView,
  onArchiveView,
  isLoading,
  isError,
}: {
  views: OpportunityViewDefinition[];
  activeViewId: string | null;
  onViewChange: (viewId: string) => void;
  onCreateView: () => void;
  onArchiveView?: (view: OpportunityViewDefinition) => void;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const { t } = useDictionary("pipeline");
  const [favoriteViewId, setFavoriteViewId] = useState<string | null>(() =>
    readStoredFavoriteId(),
  );

  // Drop a stored favorite that no longer points at an available view (the view
  // was archived, deleted, or belongs to another user) so the star never ghosts.
  useEffect(() => {
    if (!favoriteViewId) return;
    if (views.some((view) => view.id === favoriteViewId)) return;
    setFavoriteViewId(null);
    writeStoredFavoriteId(null);
  }, [favoriteViewId, views]);

  const toggleFavorite = useCallback((viewId: string) => {
    setFavoriteViewId((current) => {
      const next = current === viewId ? null : viewId;
      writeStoredFavoriteId(next);
      return next;
    });
  }, []);

  // Favorited view floats to the front; everything else keeps its incoming
  // order (already sorted by sortPosition/name at the shell).
  const orderedViews = useMemo(() => {
    if (!favoriteViewId) return views;
    const favorite = views.find((view) => view.id === favoriteViewId);
    if (!favorite) return views;
    return [favorite, ...views.filter((view) => view.id !== favoriteViewId)];
  }, [favoriteViewId, views]);

  const statusLabel = isLoading
    ? t("table.views.loading")
    : isError
      ? t("table.views.error")
      : views.length === 0
        ? t("table.views.empty")
        : null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-0 py-[4px]">
      {statusLabel ? (
        <div className="shrink-0 px-2 py-1 font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          {statusLabel}
        </div>
      ) : (
        orderedViews.map((view) => {
          const active = view.id === activeViewId;
          const favorited = view.id === favoriteViewId;
          return (
            <div
              key={view.id}
              className={cn(
                "inline-flex h-[28px] shrink-0 items-center rounded-chip border font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                active
                  ? "border-border bg-surface-active text-text"
                  : "border-border text-text-3 hover:text-text-2",
              )}
            >
              <button
                type="button"
                aria-label={
                  favorited
                    ? t("table.views.unpinFavorite").replace("{name}", view.name)
                    : t("table.views.pinFavorite").replace("{name}", view.name)
                }
                aria-pressed={favorited}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFavorite(view.id);
                }}
                className="ml-0.5 flex h-[20px] w-[20px] items-center justify-center rounded-[5px] text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              >
                <Star
                  className={cn("h-[12px] w-[12px]", favorited && "text-text-2")}
                  strokeWidth={1.5}
                  fill={favorited ? "currentColor" : "none"}
                />
              </button>
              <button
                type="button"
                onClick={() => onViewChange(view.id)}
                className={cn(
                  "inline-flex h-full min-w-0 items-center gap-1 px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  active && "bg-surface-active text-text",
                )}
              >
                {active && <Check className="h-[12px] w-[12px]" strokeWidth={1.5} />}
                <span className="truncate">{view.name}</span>
              </button>
              {!view.isDefault && view.ownerType === "user" && onArchiveView ? (
                <button
                  type="button"
                  aria-label={t("table.views.archiveInline").replace("{name}", view.name)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchiveView(view);
                  }}
                  className="mr-0.5 flex h-[20px] w-[20px] items-center justify-center rounded-[5px] text-text-mute transition-colors hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                >
                  <X className="h-[12px] w-[12px]" strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={onCreateView}
        className="ml-auto inline-flex h-[28px] shrink-0 items-center gap-1 rounded-[5px] border border-border px-2 font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
      >
        <Plus className="h-[12px] w-[12px]" strokeWidth={1.5} />
        {t("table.views.newView")}
      </button>
    </div>
  );
}
