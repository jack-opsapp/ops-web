import { PROJECT_STATUS_COLORS, ProjectStatus } from "@/lib/types/models";

/**
 * On-palette "healthy / complete" olive (DESIGN.md earth-tone ramp:
 * olive = positive → tan → rose = negative → brick = destructive).
 *
 * A finished progress bar must read positive — never the rose that
 * PROJECT_STATUS_COLORS assigns to the Completed *status*. Cohesion audit §6
 * flagged the Projects progress bars rendering rose at 100% ("completion
 * reading as a negative color"). We override only the progress-bar context;
 * the global status color (pins, dots, tags) is iOS-synced and left untouched.
 */
export const PROGRESS_COMPLETE_COLOR = "#9DB582";

/**
 * Fill color for a task-completion progress bar: status-tinted while work is
 * in flight, olive once the bar is full (fraction ≥ 1) or the project is
 * Completed, so completion never reads as rose.
 */
export function projectProgressColor(status: ProjectStatus, fraction: number): string {
  if (fraction >= 1 || status === ProjectStatus.Completed) {
    return PROGRESS_COMPLETE_COLOR;
  }
  return PROJECT_STATUS_COLORS[status] ?? PROGRESS_COMPLETE_COLOR;
}
