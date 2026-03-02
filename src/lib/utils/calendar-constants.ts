/**
 * OPS Web - Calendar Constants
 *
 * Shared constants for calendar views: hours, dimensions, task type colors.
 */

// ─── Time Grid ───────────────────────────────────────────────────────────────

/** Visible hours: 6 AM → 10 PM */
export const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);

/** Pixels per hour in week/day view */
export const HOUR_HEIGHT = 60;

/** First visible hour */
export const FIRST_HOUR = 6;

/** Last visible hour (exclusive) */
export const LAST_HOUR = 22;

// ─── Task Type Colors ────────────────────────────────────────────────────────

export interface TaskTypeColors {
  bg: string;
  border: string;
  text: string;
}

export const TASK_TYPE_COLORS: Record<string, TaskTypeColors> = {
  installation: {
    bg: "rgba(147, 26, 50, 0.25)",
    border: "#931A32",
    text: "#E8899A",
  },
  material: {
    bg: "rgba(196, 168, 104, 0.25)",
    border: "#C4A868",
    text: "#E8D9A8",
  },
  estimate: {
    bg: "rgba(165, 179, 104, 0.25)",
    border: "#A5B368",
    text: "#CDD8A8",
  },
  inspection: {
    bg: "rgba(123, 104, 166, 0.25)",
    border: "#7B68A6",
    text: "#BDB0D8",
  },
  quote: {
    bg: "rgba(89, 119, 159, 0.25)",
    border: "#59779F",
    text: "#A8C0D8",
  },
  completion: {
    bg: "rgba(74, 74, 74, 0.35)",
    border: "#4A4A4A",
    text: "#AAAAAA",
  },
};

/** Default fallback color set */
export const DEFAULT_TASK_TYPE_COLORS = TASK_TYPE_COLORS.quote;
