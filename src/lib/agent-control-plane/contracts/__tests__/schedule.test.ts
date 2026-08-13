import { describe, expect, it } from "vitest";

import {
  JobReadinessIssuesInputSchema,
  ScheduledJobOccurrenceSchema,
  ScheduledJobsInputSchema,
} from "../schedule";

const WINDOW = {
  from: "2026-08-12T00:00:00.000Z",
  to: "2026-08-19T00:00:00.000Z",
} as const;

function occurrence(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    job_ref: {
      kind: "project",
      id: "11111111-1111-4111-8111-111111111111",
    },
    occurrence_ref: {
      kind: "project_task",
      id: "22222222-2222-4222-8222-222222222222",
    },
    title: "Install railings",
    address: "100 Main Street, Vancouver, BC",
    task_status: "active",
    timing_state: "upcoming",
    confirmation_state: "confirmed",
    schedule_confirmed_at: "2026-08-11T18:00:00.000Z",
    confirmed_schedule_version: 3,
    schedule_locked: false,
    schedule_version: 3,
    task_updated_at: "2026-08-11T18:00:00.000Z",
    project_status: "accepted",
    project_status_version: 2,
    project_updated_at: "2026-08-11T17:00:00.000Z",
    schedule: {
      all_day: false,
      company_timezone: "America/Vancouver",
      local_start: "2026-08-12T08:00:00",
      local_end_inclusive: "2026-08-12T16:00:00",
      start_utc: "2026-08-12T15:00:00.000Z",
      start_utc_offset_minutes: -420,
      start_pre_boundary_utc_offset_minutes: null,
      end_utc_exclusive: "2026-08-12T23:00:00.000Z",
      end_utc_offset_minutes: -420,
      end_pre_boundary_utc_offset_minutes: null,
      display: {
        timezone: "America/Vancouver",
        local_start: "2026-08-12T08:00:00.000",
        local_end_exclusive: "2026-08-12T16:00:00.000",
        start_utc_offset_minutes: -420,
        end_utc_offset_minutes: -420,
      },
    },
    assignments: [
      {
        user_id: "33333333-3333-4333-8333-333333333333",
        display_name: "Sam Lee",
      },
    ],
    assignment_total: 1,
    assignments_omitted_count: 0,
    ...overrides,
  };
}

describe("schedule and readiness input contracts", () => {
  it("materializes canonical defaults and keeps lifecycle separate from confirmation", () => {
    expect(ScheduledJobsInputSchema.parse(WINDOW)).toEqual({
      ...WINDOW,
      limit: 25,
      task_statuses: ["active"],
    });

    expect(
      ScheduledJobsInputSchema.parse({
        ...WINDOW,
        task_statuses: ["active", "completed", "cancelled"],
        confirmation_states: ["confirmed", "unconfirmed"],
      })
    ).toEqual({
      ...WINDOW,
      limit: 25,
      task_statuses: ["active", "completed", "cancelled"],
      confirmation_states: ["confirmed", "unconfirmed"],
    });

    for (const conflatedStatus of [
      "scheduled",
      "confirmed",
      "in_progress",
      "complete",
    ]) {
      expect(
        ScheduledJobsInputSchema.safeParse({
          ...WINDOW,
          task_statuses: [conflatedStatus],
        }).success
      ).toBe(false);
    }
  });

  it("rejects duplicate schedule filters instead of broadening or reordering them", () => {
    expect(
      ScheduledJobsInputSchema.safeParse({
        ...WINDOW,
        task_statuses: ["active", "active"],
      }).success
    ).toBe(false);
    expect(
      ScheduledJobsInputSchema.safeParse({
        ...WINDOW,
        confirmation_states: ["confirmed", "confirmed"],
      }).success
    ).toBe(false);
  });

  it("enforces a positive 90-day maximum window and default/maximum page bounds", () => {
    const exactlyNinetyDays = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-04-01T00:00:00.000Z",
    };
    const overNinetyDays = {
      ...exactlyNinetyDays,
      to: "2026-04-01T00:00:00.001Z",
    };

    expect(ScheduledJobsInputSchema.parse(exactlyNinetyDays).limit).toBe(25);
    expect(
      ScheduledJobsInputSchema.safeParse({ ...exactlyNinetyDays, limit: 50 })
        .success
    ).toBe(true);
    expect(
      ScheduledJobsInputSchema.safeParse({ ...exactlyNinetyDays, limit: 51 })
        .success
    ).toBe(false);
    expect(ScheduledJobsInputSchema.safeParse(overNinetyDays).success).toBe(
      false
    );
    expect(
      ScheduledJobsInputSchema.safeParse({
        ...exactlyNinetyDays,
        to: exactlyNinetyDays.from,
      }).success
    ).toBe(false);
    expect(
      JobReadinessIssuesInputSchema.safeParse(overNinetyDays).success
    ).toBe(false);
    expect(
      JobReadinessIssuesInputSchema.safeParse({
        ...exactlyNinetyDays,
        limit: 50,
      }).success
    ).toBe(true);
    expect(
      JobReadinessIssuesInputSchema.safeParse({
        ...exactlyNinetyDays,
        limit: 51,
      }).success
    ).toBe(false);
  });

  it("materializes the fixed readiness rule order and rejects duplicate selectors", () => {
    expect(JobReadinessIssuesInputSchema.parse(WINDOW)).toEqual({
      ...WINDOW,
      limit: 25,
      include_clear: false,
      rule_codes: [
        "SITE_PHOTOS_MISSING",
        "CUSTOMER_RECORD_UNRESOLVED",
        "SCHEDULE_UNCONFIRMED",
        "CREW_UNASSIGNED",
        "ADDRESS_INCOMPLETE",
      ],
    });

    expect(
      JobReadinessIssuesInputSchema.safeParse({
        ...WINDOW,
        rule_codes: ["CREW_UNASSIGNED", "CREW_UNASSIGNED"],
      }).success
    ).toBe(false);
    expect(
      JobReadinessIssuesInputSchema.safeParse({
        ...WINDOW,
        rule_codes: ["CUSTOMER_CONTACT_UNRESOLVED"],
      }).success
    ).toBe(false);
    expect(
      ScheduledJobsInputSchema.safeParse({
        ...WINDOW,
        task_statuses: [],
      }).success
    ).toBe(false);
    expect(
      JobReadinessIssuesInputSchema.safeParse({
        ...WINDOW,
        rule_codes: [],
      }).success
    ).toBe(false);
  });

  it("rejects caller-selected tenant, policy, and unknown input fields", () => {
    for (const injected of [
      { company_id: "attacker-company" },
      { actor_id: "attacker-actor" },
      { permission_scope: "all" },
      { statuses: ["confirmed"] },
      { unknown: true },
    ]) {
      expect(
        ScheduledJobsInputSchema.safeParse({ ...WINDOW, ...injected }).success
      ).toBe(false);
      expect(
        JobReadinessIssuesInputSchema.safeParse({ ...WINDOW, ...injected })
          .success
      ).toBe(false);
    }
  });
});

describe("scheduled occurrence output contract", () => {
  it("keeps task lifecycle, temporal timing, and confirmation orthogonal", () => {
    expect(ScheduledJobOccurrenceSchema.safeParse(occurrence()).success).toBe(
      true
    );
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          task_status: "active",
          timing_state: "past_due",
          confirmation_state: "unconfirmed",
          schedule_confirmed_at: null,
          confirmed_schedule_version: null,
          schedule_locked: true,
        })
      ).success
    ).toBe(true);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ task_status: "completed", timing_state: "past" })
      ).success
    ).toBe(true);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ task_status: "cancelled", timing_state: "past" })
      ).success
    ).toBe(true);

    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ task_status: "active", timing_state: "past" })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ task_status: "completed", timing_state: "upcoming" })
      ).success
    ).toBe(false);
  });

  it("requires confirmation state to agree with its exact marker", () => {
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          confirmation_state: "confirmed",
          schedule_confirmed_at: null,
        })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          confirmation_state: "unconfirmed",
          schedule_confirmed_at: "2026-08-11T18:00:00.000Z",
          confirmed_schedule_version: null,
        })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ confirmed_schedule_version: 2 })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          confirmation_state: "unconfirmed",
          schedule_confirmed_at: null,
          confirmed_schedule_version: 3,
        })
      ).success
    ).toBe(false);
  });

  it("requires exact project-task identity, versions, and a positive schedule interval", () => {
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ occurrence_ref: { kind: "site_visit", id: "visit-1" } })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ schedule_version: -1 })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ project_status_version: -1 })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          schedule: {
            ...occurrence().schedule,
            end_utc_exclusive: "2026-08-12T15:00:00.000Z",
          },
        })
      ).success
    ).toBe(false);
  });

  it("represents an overnight timed occurrence with its end on the next local day", () => {
    const overnightSchedule = {
      ...occurrence().schedule,
      local_start: "2026-08-12T22:00:00",
      local_end_inclusive: "2026-08-13T02:00:00",
      start_utc: "2026-08-13T05:00:00.000Z",
      end_utc_exclusive: "2026-08-13T09:00:00.000Z",
    };

    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ schedule: overnightSchedule })
      ).success
    ).toBe(true);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          schedule: {
            ...overnightSchedule,
            local_end_inclusive: "2026-08-12T02:00:00",
          },
        })
      ).success
    ).toBe(false);
  });

  it.each([
    {
      label: "23-hour spring transition",
      localStart: "2026-03-07T08:00:00",
      localEnd: "2026-03-08T08:00:00",
      startUtc: "2026-03-07T16:00:00.000Z",
      endUtc: "2026-03-08T15:00:00.000Z",
    },
    {
      label: "25-hour fall transition",
      localStart: "2026-10-31T08:00:00",
      localEnd: "2026-11-01T08:00:00",
      startUtc: "2026-10-31T15:00:00.000Z",
      endUtc: "2026-11-01T16:00:00.000Z",
    },
  ])(
    "treats equal start/end wall times as a next-day interval across the $label",
    ({ localStart, localEnd, startUtc, endUtc }) => {
      expect(
        ScheduledJobOccurrenceSchema.safeParse(
          occurrence({
            schedule: {
              ...occurrence().schedule,
              local_start: localStart,
              local_end_inclusive: localEnd,
              start_utc: startUtc,
              end_utc_exclusive: endUtc,
            },
          })
        ).success
      ).toBe(true);
    }
  );

  it("allows only customer-shareable crew fields and unique assignments", () => {
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          assignments: [
            {
              user_id: "33333333-3333-4333-8333-333333333333",
              display_name: "Sam Lee",
              email: "private@ops.test",
            },
          ],
        })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({
          assignments: [
            {
              user_id: "33333333-3333-4333-8333-333333333333",
              display_name: "Sam Lee",
            },
            {
              user_id: "33333333-3333-4333-8333-333333333333",
              display_name: "Sam Lee",
            },
          ],
        })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ assignment_total: 2, assignments_omitted_count: 0 })
      ).success
    ).toBe(false);
    expect(
      ScheduledJobOccurrenceSchema.safeParse(
        occurrence({ assignment_total: 2, assignments_omitted_count: 1 })
      ).success
    ).toBe(true);
  });
});
