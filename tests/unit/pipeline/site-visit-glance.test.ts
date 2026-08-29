import { describe, it, expect } from "vitest";
import { SiteVisitStatus, type SiteVisit } from "@/lib/types/pipeline";
import {
  deriveSiteVisitGlance,
  buildSiteVisitGlanceMap,
} from "@/lib/utils/site-visit-glance";

// Every case injects `now`, so these assertions are stable forever rather
// than drifting into "passes until next Tuesday".
const NOW = new Date("2026-08-20T15:00:00.000Z");

function makeVisit(overrides: Partial<SiteVisit> = {}): SiteVisit {
  return {
    id: "sv-1",
    companyId: "co-1",
    opportunityId: "opp-1",
    projectId: null,
    clientId: null,
    scheduledAt: new Date("2026-08-25T17:00:00.000Z"),
    durationMinutes: 60,
    assigneeIds: [],
    status: SiteVisitStatus.Scheduled,
    completedAt: null,
    notes: null,
    internalNotes: null,
    measurements: null,
    photos: [],
    activityId: null,
    calendarEventId: null,
    createdBy: "user-1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    deletedAt: null,
    bookedAt: new Date("2026-08-01T00:00:00.000Z"),
    reminderLeadMinutes: null,
    ...overrides,
  };
}

describe("deriveSiteVisitGlance", () => {
  it("returns an empty glance for no visits", () => {
    expect(deriveSiteVisitGlance([], NOW)).toEqual({
      nextAt: null,
      lastCompletedAt: null,
      count: 0,
    });
  });

  it("surfaces a booked future visit as nextAt", () => {
    const visit = makeVisit();
    const glance = deriveSiteVisitGlance([visit], NOW);
    expect(glance.nextAt).toEqual(visit.scheduledAt);
    expect(glance.lastCompletedAt).toBeNull();
    expect(glance.count).toBe(1);
  });

  it("picks the soonest of several booked future visits", () => {
    const soon = makeVisit({
      id: "sv-soon",
      scheduledAt: new Date("2026-08-22T17:00:00.000Z"),
    });
    const later = makeVisit({
      id: "sv-later",
      scheduledAt: new Date("2026-09-02T17:00:00.000Z"),
    });
    const glance = deriveSiteVisitGlance([later, soon], NOW);
    expect(glance.nextAt).toEqual(soon.scheduledAt);
    expect(glance.count).toBe(2);
  });

  it("still counts a visit scheduled earlier today as upcoming", () => {
    // Booked for 09:00 when it is already 15:00 — the visit is today's, and an
    // owner scanning the board needs to see today, not a blank cell.
    const glance = deriveSiteVisitGlance(
      [makeVisit({ scheduledAt: new Date("2026-08-20T09:00:00.000Z") })],
      NOW
    );
    expect(glance.nextAt).toEqual(new Date("2026-08-20T09:00:00.000Z"));
  });

  it("does not surface a booked visit from a previous day as upcoming", () => {
    const glance = deriveSiteVisitGlance(
      [makeVisit({ scheduledAt: new Date("2026-08-18T09:00:00.000Z") })],
      NOW
    );
    expect(glance.nextAt).toBeNull();
    expect(glance.count).toBe(1);
  });

  it("treats an in-progress visit as upcoming regardless of its date", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({
          status: SiteVisitStatus.InProgress,
          scheduledAt: new Date("2026-08-19T09:00:00.000Z"),
        }),
      ],
      NOW
    );
    expect(glance.nextAt).toEqual(new Date("2026-08-19T09:00:00.000Z"));
  });

  it("never treats a walk-up row as upcoming", () => {
    // bookedAt === null means scheduled_at defaulted to created_at and is
    // meaningless as an appointment — it must never reach a scheduling surface.
    const glance = deriveSiteVisitGlance(
      [makeVisit({ bookedAt: null })],
      NOW
    );
    expect(glance.nextAt).toBeNull();
    expect(glance.count).toBe(1);
  });

  it("counts a completed walk-up as a real completion", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({
          bookedAt: null,
          status: SiteVisitStatus.Completed,
          scheduledAt: new Date("2026-08-12T17:00:00.000Z"),
          completedAt: new Date("2026-08-12T18:30:00.000Z"),
        }),
      ],
      NOW
    );
    expect(glance.lastCompletedAt).toEqual(
      new Date("2026-08-12T18:30:00.000Z")
    );
    expect(glance.nextAt).toBeNull();
  });

  it("falls back to scheduledAt when a completed visit has no completedAt", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({
          status: SiteVisitStatus.Completed,
          scheduledAt: new Date("2026-08-11T17:00:00.000Z"),
          completedAt: null,
        }),
      ],
      NOW
    );
    expect(glance.lastCompletedAt).toEqual(
      new Date("2026-08-11T17:00:00.000Z")
    );
  });

  it("keeps the latest of several completions", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({
          id: "sv-old",
          status: SiteVisitStatus.Completed,
          completedAt: new Date("2026-08-05T17:00:00.000Z"),
        }),
        makeVisit({
          id: "sv-recent",
          status: SiteVisitStatus.Completed,
          completedAt: new Date("2026-08-14T17:00:00.000Z"),
        }),
      ],
      NOW
    );
    expect(glance.lastCompletedAt).toEqual(
      new Date("2026-08-14T17:00:00.000Z")
    );
    expect(glance.count).toBe(2);
  });

  it("ignores cancelled and soft-deleted visits entirely", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({ id: "sv-cancelled", status: SiteVisitStatus.Cancelled }),
        makeVisit({
          id: "sv-deleted",
          deletedAt: new Date("2026-08-10T00:00:00.000Z"),
        }),
      ],
      NOW
    );
    expect(glance).toEqual({ nextAt: null, lastCompletedAt: null, count: 0 });
  });

  it("reports an upcoming visit and a past completion together", () => {
    const glance = deriveSiteVisitGlance(
      [
        makeVisit({ id: "sv-next" }),
        makeVisit({
          id: "sv-done",
          status: SiteVisitStatus.Completed,
          completedAt: new Date("2026-08-08T17:00:00.000Z"),
        }),
      ],
      NOW
    );
    expect(glance.nextAt).toEqual(new Date("2026-08-25T17:00:00.000Z"));
    expect(glance.lastCompletedAt).toEqual(
      new Date("2026-08-08T17:00:00.000Z")
    );
    expect(glance.count).toBe(2);
  });
});

describe("buildSiteVisitGlanceMap", () => {
  it("keys one glance per opportunity", () => {
    const map = buildSiteVisitGlanceMap(
      [
        makeVisit({ id: "a1", opportunityId: "opp-a" }),
        makeVisit({
          id: "a2",
          opportunityId: "opp-a",
          status: SiteVisitStatus.Completed,
          completedAt: new Date("2026-08-09T17:00:00.000Z"),
        }),
        makeVisit({ id: "b1", opportunityId: "opp-b", bookedAt: null }),
      ],
      NOW
    );

    expect(map.size).toBe(2);
    expect(map.get("opp-a")).toEqual({
      nextAt: new Date("2026-08-25T17:00:00.000Z"),
      lastCompletedAt: new Date("2026-08-09T17:00:00.000Z"),
      count: 2,
    });
    expect(map.get("opp-b")?.nextAt).toBeNull();
    expect(map.get("opp-b")?.count).toBe(1);
  });

  it("skips visits with no opportunity (project-only visits)", () => {
    const map = buildSiteVisitGlanceMap(
      [makeVisit({ id: "p1", opportunityId: null, projectId: "proj-1" })],
      NOW
    );
    expect(map.size).toBe(0);
  });

  it("omits an opportunity whose visits are all cancelled", () => {
    const map = buildSiteVisitGlanceMap(
      [
        makeVisit({
          id: "c1",
          opportunityId: "opp-c",
          status: SiteVisitStatus.Cancelled,
        }),
      ],
      NOW
    );
    expect(map.has("opp-c")).toBe(false);
  });
});
