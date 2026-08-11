/**
 * Site-visit prompt engine — pure due-window math for the booking prompt cron.
 *
 * Server prompts for a booked visit, per assignee:
 *   heads-up  due while  scheduled_at − lead ≤ now < scheduled_at
 *   start     due while  scheduled_at ≤ now < scheduled_at + 15 min
 *
 * Lead resolution: booking override → user default → product default 30.
 * Idempotency lives entirely in the dedupe key — it embeds epoch(scheduled_at),
 * so a reschedule re-arms both prompts by construction. Keys must match the
 * partial unique index `notifications_site_visit_prompt_dedupe_uidx`
 * (`dedupe_key LIKE 'site_visit:%'`) and the iOS routing contract exactly.
 */

export const DEFAULT_SITE_VISIT_REMINDER_LEAD_MINUTES = 30;
export const START_PROMPT_GRACE_MINUTES = 15;

export type SiteVisitPromptKind = "heads_up" | "start";

export interface PromptCandidateVisit {
  id: string;
  /** `site_visit_status` enum value — only `scheduled` visits prompt. */
  status: string;
  /** Booking discriminator. NULL = walk-up/legacy; never prompts. */
  bookedAt: string | null;
  deletedAt: string | null;
  /** Appointment start (ISO). Only meaningful when bookedAt is non-null. */
  scheduledAt: string;
  /** Per-booking heads-up override in minutes. NULL = use the user default. */
  reminderLeadMinutes: number | null;
  /** `users.id` values of who is going. */
  assigneeIds: string[] | null;
}

export interface PromptAssigneePreference {
  userId: string;
  /** `notification_preferences.site_visit_reminder_lead_minutes`. NULL = product default. */
  siteVisitReminderLeadMinutes: number | null;
}

export interface DueSiteVisitPrompt {
  userId: string;
  kind: SiteVisitPromptKind;
  dedupeKey: string;
}

const MINUTE_MS = 60_000;

export function scheduledAtEpochSeconds(scheduledAt: string): number {
  return Math.floor(Date.parse(scheduledAt) / 1000);
}

export function siteVisitPromptDedupeKey(
  visitId: string,
  kind: SiteVisitPromptKind,
  userId: string,
  epochSeconds: number
): string {
  return `site_visit:${visitId}:${kind}:${userId}:${epochSeconds}`;
}

export function dueSiteVisitPrompts(
  visit: PromptCandidateVisit,
  assigneePreferences: PromptAssigneePreference[],
  now: Date
): DueSiteVisitPrompt[] {
  if (visit.bookedAt === null) return [];
  if (visit.deletedAt !== null) return [];
  if (visit.status !== "scheduled") return [];

  const scheduledMs = Date.parse(visit.scheduledAt);
  if (Number.isNaN(scheduledMs)) return [];

  const assigneeIds = [...new Set(visit.assigneeIds ?? [])];
  if (assigneeIds.length === 0) return [];

  const nowMs = now.getTime();
  const epochSeconds = Math.floor(scheduledMs / 1000);
  const leadByUser = new Map(
    assigneePreferences.map((preference) => [
      preference.userId,
      preference.siteVisitReminderLeadMinutes,
    ])
  );

  const due: DueSiteVisitPrompt[] = [];
  for (const userId of assigneeIds) {
    const leadMinutes =
      visit.reminderLeadMinutes ??
      leadByUser.get(userId) ??
      DEFAULT_SITE_VISIT_REMINDER_LEAD_MINUTES;

    const headsUpOpensMs = scheduledMs - leadMinutes * MINUTE_MS;
    const startClosesMs = scheduledMs + START_PROMPT_GRACE_MINUTES * MINUTE_MS;

    // Windows are disjoint by construction: heads-up ends where start begins,
    // so a late cron never fires a stale heads-up on top of the START prompt.
    if (headsUpOpensMs <= nowMs && nowMs < scheduledMs) {
      due.push({
        userId,
        kind: "heads_up",
        dedupeKey: siteVisitPromptDedupeKey(
          visit.id,
          "heads_up",
          userId,
          epochSeconds
        ),
      });
    } else if (scheduledMs <= nowMs && nowMs < startClosesMs) {
      due.push({
        userId,
        kind: "start",
        dedupeKey: siteVisitPromptDedupeKey(
          visit.id,
          "start",
          userId,
          epochSeconds
        ),
      });
    }
  }
  return due;
}
