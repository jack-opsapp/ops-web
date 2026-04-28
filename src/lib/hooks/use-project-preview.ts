/**
 * OPS Web - Project Preview Hook
 *
 * Lazy-fetched preview for the calendar event hover popover. Gated by
 * `enabled` so we only hit Supabase when the popover actually opens.
 *
 * Cached for 5 minutes per project — hovering the same card multiple times
 * doesn't re-fetch.
 */

import { useQuery } from "@tanstack/react-query";
import {
  ProjectPreviewService,
  type ProjectPreview,
} from "@/lib/api/services/project-preview-service";

const FIVE_MINUTES = 5 * 60 * 1000;

export function useProjectPreview(
  projectId: string | null | undefined,
  options: { enabled?: boolean } = {}
) {
  return useQuery<ProjectPreview>({
    queryKey: ["project-preview", projectId ?? ""],
    queryFn: () => ProjectPreviewService.fetch(projectId!),
    enabled: !!projectId && options.enabled !== false,
    staleTime: FIVE_MINUTES,
  });
}
