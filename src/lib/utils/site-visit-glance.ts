/**
 * OPS Web — site-visit glance derivation.
 *
 * Reduces a company's site-visit rows to the two facts an owner scanning the
 * pipeline actually needs per lead: is a visit coming, and when was the last
 * one. Pure and clock-injected — callers pass `now`, so the same input always
 * yields the same output and the board never depends on render timing.
 *
 * The walk-up rule is the load-bearing one. A row with `bookedAt === null` is
 * a walk-up / legacy capture whose `scheduledAt` merely defaulted to
 * `createdAt`; that timestamp is not an appointment and must never reach a
 * scheduling surface. Its COMPLETION is still real history, so walk-ups are
 * excluded from `nextAt` but counted for `lastCompletedAt` and `count`.
 */

import { startOfDay } from "@/lib/utils/date";
import { SiteVisitStatus, type SiteVisit } from "@/lib/types/pipeline";

export interface SiteVisitGlance {
  /** Soonest booked visit still ahead of the operator, else null. */
  nextAt: Date | null;
  /** Most recent completed visit, else null. */
  lastCompletedAt: Date | null;
  /** Non-cancelled, non-deleted visits on this lead. */
  count: number;
}

const EMPTY_GLANCE: SiteVisitGlance = {
  nextAt: null,
  lastCompletedAt: null,
  count: 0,
};

/** Cancelled and soft-deleted rows are not history and not a plan. */
function isLive(visit: SiteVisit): boolean {
  return visit.status !== SiteVisitStatus.Cancelled && visit.deletedAt == null;
}

/**
 * A visit counts as upcoming when it is a REAL booking that has not yet
 * resolved. Anything scheduled earlier today still counts — an owner glancing
 * at the board at 15:00 needs to see the 09:00 visit, not an empty cell — and
 * an in-progress visit counts whatever its date says.
 */
function isUpcoming(visit: SiteVisit, dayStart: Date): boolean {
  if (visit.bookedAt == null) return false;
  if (visit.status === SiteVisitStatus.InProgress) return true;
  if (visit.status !== SiteVisitStatus.Scheduled) return false;
  return visit.scheduledAt.getTime() >= dayStart.getTime();
}

/** A completed visit's timestamp, falling back to when it was scheduled. */
function completionAt(visit: SiteVisit): Date | null {
  if (visit.status !== SiteVisitStatus.Completed) return null;
  return visit.completedAt ?? visit.scheduledAt;
}

export function deriveSiteVisitGlance(
  visits: SiteVisit[],
  now: Date
): SiteVisitGlance {
  const dayStart = startOfDay(now);
  let nextAt: Date | null = null;
  let lastCompletedAt: Date | null = null;
  let count = 0;

  for (const visit of visits) {
    if (!isLive(visit)) continue;
    count += 1;

    if (isUpcoming(visit, dayStart)) {
      if (nextAt === null || visit.scheduledAt.getTime() < nextAt.getTime()) {
        nextAt = visit.scheduledAt;
      }
    }

    const completed = completionAt(visit);
    if (
      completed !== null &&
      (lastCompletedAt === null ||
        completed.getTime() > lastCompletedAt.getTime())
    ) {
      lastCompletedAt = completed;
    }
  }

  return count === 0 ? EMPTY_GLANCE : { nextAt, lastCompletedAt, count };
}

/**
 * One glance per opportunity, from a company-wide visit list. Rows with no
 * `opportunityId` (project-only visits) are skipped, and an opportunity whose
 * every row is cancelled or deleted is omitted entirely rather than mapped to
 * an empty glance — callers treat "absent" and "nothing to show" the same way.
 */
export function buildSiteVisitGlanceMap(
  visits: SiteVisit[],
  now: Date
): Map<string, SiteVisitGlance> {
  const byOpportunity = new Map<string, SiteVisit[]>();
  for (const visit of visits) {
    const opportunityId = visit.opportunityId;
    if (!opportunityId) continue;
    const bucket = byOpportunity.get(opportunityId);
    if (bucket) bucket.push(visit);
    else byOpportunity.set(opportunityId, [visit]);
  }

  const glances = new Map<string, SiteVisitGlance>();
  for (const [opportunityId, rows] of byOpportunity) {
    const glance = deriveSiteVisitGlance(rows, now);
    if (glance.count > 0) glances.set(opportunityId, glance);
  }
  return glances;
}
