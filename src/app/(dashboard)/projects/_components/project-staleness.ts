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

  // Use createdAt as reference — projects naturally sit in statuses for weeks/months
  const createdAt = project.createdAt;
  if (!createdAt) return 1.0;

  const daysSinceCreated = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Projects have much longer lifecycles than pipeline deals
  // Only start dimming after 90 days, fully stale at 6 months
  const freshDays = 90;
  const staleDays = 180;

  if (daysSinceCreated <= freshDays) return 1.0;
  if (daysSinceCreated >= staleDays) return 0.5;

  const progress =
    (daysSinceCreated - freshDays) / (staleDays - freshDays);
  return 1.0 - progress * 0.5;
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
