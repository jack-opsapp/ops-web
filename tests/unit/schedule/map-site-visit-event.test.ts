/**
 * mapSiteVisitToInternalEvent — booked appointments as the calendar's third
 * source. Visits are timed events with tan (site-visit) treatment, they
 * carry their lead context for the popover, and they are kind
 * "site_visit" so every view can exclude them from task machinery
 * (drag-reschedule, cascade, auto-schedule, unscheduled tray).
 */

import { describe, it, expect } from "vitest";

import { mapSiteVisitToInternalEvent } from "@/lib/utils/schedule-utils";
import { SiteVisitStatus } from "@/lib/types/pipeline";
import type { BookedVisitWithLead } from "@/lib/api/services/site-visit-service";

const VISIT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OPP_ID = "bbbbbbbb-2222-4222-8222-222222222222";

function makeBookedVisit(
  overrides: Partial<BookedVisitWithLead> = {}
): BookedVisitWithLead {
  return {
    id: VISIT_ID,
    companyId: "co-1",
    opportunityId: OPP_ID,
    projectId: null,
    clientId: null,
    scheduledAt: new Date("2026-08-20T10:00:00"),
    durationMinutes: 90,
    assigneeIds: ["user-1", "user-2"],
    status: SiteVisitStatus.Scheduled,
    completedAt: null,
    notes: null,
    internalNotes: null,
    measurements: null,
    photos: [],
    activityId: null,
    calendarEventId: null,
    createdBy: "user-1",
    createdAt: new Date("2026-08-11T09:00:00"),
    updatedAt: new Date("2026-08-11T09:00:00"),
    deletedAt: null,
    bookedAt: new Date("2026-08-11T09:00:00"),
    reminderLeadMinutes: null,
    lead: {
      id: OPP_ID,
      title: "Greenway re-roof",
      address: "1180 Howe St, Vancouver, BC",
      clientName: "Greenway Property Group",
    },
    ...overrides,
  };
}

describe("mapSiteVisitToInternalEvent", () => {
  it("maps a booked visit to a timed site_visit event with lead context", () => {
    const visit = makeBookedVisit();
    const event = mapSiteVisitToInternalEvent(visit);

    expect(event.kind).toBe("site_visit");
    expect(event.id).toBe(VISIT_ID);
    expect(event.title).toBe("Greenway re-roof");
    expect(event.typeLabel).toBe("SITE VISIT");
    // Legend + type filtering key off the same value as the label.
    expect(event.taskType).toBe("SITE VISIT");

    // Timed: start at the appointment, end = start + duration.
    expect(event.allDay).toBe(false);
    expect(event.startDate).toEqual(new Date("2026-08-20T10:00:00"));
    expect(event.endDate).toEqual(new Date("2026-08-20T11:30:00"));

    // Crew + lead context for cards and the popover.
    expect(event.crewIds).toEqual(["user-1", "user-2"]);
    expect(event.teamMemberIds).toEqual(["user-1", "user-2"]);
    expect(event.address).toBe("1180 Howe St, Vancouver, BC");
    expect(event.clientName).toBe("Greenway Property Group");
    expect(event.opportunityId).toBe(OPP_ID);
    expect(event.siteVisit).toBe(visit);

    // Never routes into the project-window click path.
    expect(event.projectId).toBeUndefined();
  });

  it("uses tan (the design system's site-visit hue) for type and status color", () => {
    const event = mapSiteVisitToInternalEvent(makeBookedVisit());
    expect(event.typeColors.border).toBe("#C4A868");
    expect(event.statusColors.text).toBe("#C4A868");
  });

  it("falls back to a bare title when the lead embed is missing", () => {
    const event = mapSiteVisitToInternalEvent(makeBookedVisit({ lead: null }));
    expect(event.title).toBe("Site visit");
    expect(event.address).toBeNull();
    expect(event.clientName).toBeNull();
  });

  it("carries in_progress status through to the status key", () => {
    const event = mapSiteVisitToInternalEvent(
      makeBookedVisit({ status: SiteVisitStatus.InProgress })
    );
    expect(event.statusKey).toBe("in_progress");
  });
});
