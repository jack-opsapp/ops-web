import { ProjectStatus, type Project } from "@/lib/types/models";

/**
 * Calculate card opacity based on how long a project has been in its current status.
 *
 * Fresh projects = 1.0
 * Deeply stale = 0.4
 * Closed projects = 0.8 (terminal, slightly dimmed)
 */
export function calculateProjectStaleness(project: Project): number {
  if (project.status === ProjectStatus.Closed) return 0.8;
  if (project.status === ProjectStatus.Archived) return 0.6;

  // Use lastSyncedAt as proxy for "last activity"
  const lastActivity = project.lastSyncedAt ?? project.createdAt;
  if (!lastActivity) return 1.0;

  const daysSinceActivity = Math.floor(
    (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Expected update cadence: ~14 days for active projects
  const expectedDays = 14;

  if (daysSinceActivity <= expectedDays * 0.5) return 1.0;
  if (daysSinceActivity >= expectedDays * 2.0) return 0.4;

  const progress =
    (daysSinceActivity - expectedDays * 0.5) / (expectedDays * 1.5);
  return 1.0 - progress * 0.6;
}

/**
 * Batch-calculate staleness for multiple projects.
 * Returns Map<projectId, opacity>.
 */
export function calculateBatchProjectStaleness(
  projects: Project[]
): Map<string, number> {
  const result = new Map<string, number>();
  for (const project of projects) {
    result.set(project.id, calculateProjectStaleness(project));
  }
  return result;
}
