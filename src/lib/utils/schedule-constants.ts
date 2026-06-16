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

/**
 * Spec v2 task type palette. Hexes mirror tailwind.config.ts `tasktype` tokens.
 * `bg` = 0.18 alpha fill (calm, readable over #000); `text` = lighter shade for
 * contrast on the fill. Update both together if the base hex ever shifts.
 */
export const TASK_TYPE_COLORS: Record<string, TaskTypeColors> = {
  installation: {
    bg: "rgba(181, 130, 137, 0.18)",
    border: "#B58289",
    text: "#D9B0B5",
  },
  material: {
    bg: "rgba(196, 168, 104, 0.18)",
    border: "#C4A868",
    text: "#E8D9A8",
  },
  estimate: {
    bg: "rgba(157, 181, 130, 0.18)",
    border: "#9DB582",
    text: "#C8D6B4",
  },
  inspection: {
    bg: "rgba(166, 154, 181, 0.18)",
    border: "#A69AB5",
    text: "#CDC3D6",
  },
  quote: {
    bg: "rgba(111, 148, 176, 0.18)",
    border: "#6F94B0",
    text: "#A8C0D8",
  },
  completion: {
    bg: "rgba(156, 147, 138, 0.18)",
    border: "#9C938A",
    text: "#C9C1B7",
  },
};

/** Default fallback — stone (completion) — for unmapped task types. */
export const DEFAULT_TASK_TYPE_COLORS = TASK_TYPE_COLORS.completion;

// ─── Task Status Colors (earth-tone semantic) ────────────────────────────────

/**
 * Status palette for cards across all calendar views.
 * Drives body fill + border. Type-color drives the LEFT STRIPE only.
 *
 * scheduled  → olive  (active, future)
 * in_progress→ tan    (active, start_date <= now < end_date)
 * completed  → mute   (text-mute, decorative)
 * cancelled  → brick  (border-only on dark — never text on black)
 * overdue    → rose   (active, end_date < now)
 *
 * 'in_progress' and 'overdue' are computed in deriveTaskStatusKey() —
 * not stored on the row.
 */
export type TaskStatusKey = "scheduled" | "in_progress" | "completed" | "cancelled" | "overdue";

export interface TaskStatusColors {
  bg: string;
  border: string;
  text: string;
}

export const TASK_STATUS_COLORS: Record<TaskStatusKey, TaskStatusColors> = {
  scheduled: {
    bg: "rgba(157, 181, 130, 0.10)",
    border: "rgba(157, 181, 130, 0.30)",
    text: "#9DB582",
  },
  in_progress: {
    bg: "rgba(196, 168, 104, 0.12)",
    border: "rgba(196, 168, 104, 0.40)",
    text: "#C4A868",
  },
  completed: {
    bg: "rgba(106, 106, 106, 0.08)",
    border: "rgba(106, 106, 106, 0.25)",
    text: "#6A6A6A",
  },
  cancelled: {
    bg: "rgba(147, 50, 26, 0.06)",
    border: "rgba(147, 50, 26, 0.40)",
    text: "#93321A",
  },
  overdue: {
    bg: "rgba(181, 130, 137, 0.12)",
    border: "rgba(181, 130, 137, 0.40)",
    text: "#B58289",
  },
};
