import { describe, expect, it } from "vitest";

import {
  CrewCalloutRecoveryContractError,
  CrewCalloutRecoveryResultSchema,
  PrepareCrewCalloutRecoveryInputSchema,
  prepareCrewCalloutRecoveryPreview,
  type CrewCalloutRecoverySourceSnapshot,
} from "../crew-callout-recovery";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const MIKE_ID = "00000000-0000-4000-8000-000000000002";
const SAM_ID = "00000000-0000-4000-8000-000000000003";
const ALEX_ID = "00000000-0000-4000-8000-000000000004";
const LEE_ID = "00000000-0000-4000-8000-000000000005";
const ROLE_ID = "00000000-0000-4000-8000-000000000010";
const PROJECT_A = "00000000-0000-4000-8000-000000000020";
const PROJECT_B = "00000000-0000-4000-8000-000000000021";
const TASK_A = "00000000-0000-4000-8000-000000000030";
const TASK_B = "00000000-0000-4000-8000-000000000031";
const TYPE_A = "00000000-0000-4000-8000-000000000040";
const TYPE_B = "00000000-0000-4000-8000-000000000041";
const CLIENT_ID = "00000000-0000-4000-8000-000000000050";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function candidate(input: {
  id: string;
  name: string;
  history?: Array<{ task_type_id: string; completed_count: number }>;
  commitments?: Array<{
    kind: "task" | "site_visit" | "personal_event";
    id: string;
    start_at: string;
    end_at: string;
  }>;
  timeOff?: boolean;
  projects?: string[];
  email?: string | null;
}) {
  return {
    member_id: input.id,
    display_name: input.name,
    email:
      input.email === undefined
        ? `${input.name.toLowerCase().replaceAll(" ", ".")}@example.com`
        : input.email,
    email_source_sha256: input.email === null ? null : HASH_C,
    roles: [{ role_id: ROLE_ID, name: "Installer", source_sha256: HASH_A }],
    project_ids: [...(input.projects ?? [])].sort(),
    same_task_history: (input.history ?? []).map((row) => ({
      ...row,
      source_sha256: HASH_B,
    })),
    availability_days: [
      {
        date: "2026-09-04",
        working_start_at: "2026-09-04T15:00:00Z",
        working_end_at: "2026-09-04T23:00:00Z",
        has_time_off: input.timeOff ?? false,
        commitments: (input.commitments ?? []).map((row) => ({
          ...row,
          source_sha256: HASH_A,
        })),
        source_sha256: HASH_B,
      },
    ],
    source_sha256: HASH_C,
  };
}

function task(input: {
  id: string;
  projectId: string;
  typeId: string;
  title: string;
  start: string;
  end: string;
  recipient?: boolean;
  reschedule?: boolean;
}) {
  return {
    kind: "task" as const,
    item_id: input.id,
    project_id: input.projectId,
    project_title: input.projectId === PROJECT_A ? "Westview deck" : "Oak shop",
    project_status: "in_progress" as const,
    project_status_version: "4",
    title: input.title,
    task_type_id: input.typeId,
    schedule_version: "7",
    current_start_at: input.start,
    current_end_at: input.end,
    coverage_start_at: input.start,
    coverage_end_at: input.end,
    all_day: false,
    assignee_ids: [MIKE_ID],
    schedule_locked: false,
    recurrence_id: null,
    paired_from_task_id: null,
    dependency_count: 0,
    dependency_override_count: 0,
    recipient:
      input.recipient === false
        ? null
        : {
            kind: "client" as const,
            id: CLIENT_ID,
            display_name: "Avery Hart",
            email: "avery@example.com",
            revision: HASH_A,
            source_sha256: HASH_B,
          },
    reschedule_options:
      input.reschedule === false
        ? []
        : [
            {
              date: "2026-09-05",
              start_at: input.start.replace("2026-09-04", "2026-09-05"),
              end_at: input.end.replace("2026-09-04", "2026-09-05"),
              source_sha256: HASH_C,
            },
          ],
    source_sha256: HASH_A,
  };
}

function snapshot(): CrewCalloutRecoverySourceSnapshot {
  return {
    observed_at: "2026-09-03T18:00:00Z",
    source_revision: HASH_A,
    context: {
      company_id: COMPANY_ID,
      company_name: "OPS Roofing",
      timezone: "America/Vancouver",
      local_date: "2026-09-03",
      target_date: "2026-09-04",
      window_start_at: "2026-09-04T07:00:00Z",
      window_end_at: "2026-09-05T07:00:00Z",
      default_work_start: "08:00:00",
      default_work_end: "16:00:00",
      recovery_horizon_days: 7,
      skip_weekends: false,
      source_sha256: HASH_B,
    },
    unavailable_member: {
      member_id: MIKE_ID,
      display_name: "Mike Rowe",
      roles: [{ role_id: ROLE_ID, name: "Installer", source_sha256: HASH_A }],
      source_sha256: HASH_C,
    },
    affected_items: [
      task({
        id: TASK_A,
        projectId: PROJECT_A,
        typeId: TYPE_A,
        title: "Set posts",
        start: "2026-09-04T15:00:00Z",
        end: "2026-09-04T17:00:00Z",
      }),
      task({
        id: TASK_B,
        projectId: PROJECT_B,
        typeId: TYPE_B,
        title: "Install railing",
        start: "2026-09-04T18:00:00Z",
        end: "2026-09-04T20:00:00Z",
      }),
    ],
    candidates: [
      candidate({
        id: SAM_ID,
        name: "Sam Cole",
        history: [
          { task_type_id: TYPE_A, completed_count: 2 },
          { task_type_id: TYPE_B, completed_count: 1 },
        ],
        projects: [PROJECT_A],
      }),
      candidate({
        id: ALEX_ID,
        name: "Alex Vale",
        history: [{ task_type_id: TYPE_A, completed_count: 8 }],
      }),
      candidate({
        id: LEE_ID,
        name: "Lee Stone",
        history: [{ task_type_id: TYPE_B, completed_count: 7 }],
      }),
    ],
  };
}

describe("crew call-out recovery contract", () => {
  it("accepts only one exact crew name and canonical company-local date", () => {
    expect(
      PrepareCrewCalloutRecoveryInputSchema.parse({
        crew_member_name: "Mike",
        target_date: "2026-09-04",
      })
    ).toEqual({ crew_member_name: "Mike", target_date: "2026-09-04" });
    expect(() =>
      PrepareCrewCalloutRecoveryInputSchema.parse({
        crew_member_name: " Mike ",
        target_date: "tomorrow",
        company_id: COMPANY_ID,
      })
    ).toThrow();
  });

  it("uses one proven member across non-overlapping work instead of two", () => {
    const result = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-1",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: snapshot(),
    });

    expect(CrewCalloutRecoveryResultSchema.parse(result)).toEqual(result);
    expect(result.proposal.replacements).toEqual([
      expect.objectContaining({
        item_id: TASK_A,
        replacement_member_id: SAM_ID,
      }),
      expect.objectContaining({
        item_id: TASK_B,
        replacement_member_id: SAM_ID,
      }),
    ]);
    expect(result.proposal.replacement_member_count).toBe(1);
    expect(result.proposal.reschedules).toEqual([]);
    expect(result.proposal.uncovered).toEqual([]);
    expect(result.drafts.internal).toEqual([
      expect.objectContaining({
        recipient: expect.objectContaining({ id: SAM_ID }),
        subject: "Coverage request — September 4",
      }),
    ]);
    expect(result.drafts.client).toEqual([]);
  });

  it("never assigns one replacement to overlapping work", () => {
    const source = snapshot();
    source.affected_items[1]!.current_start_at = "2026-09-04T16:00:00Z";
    source.affected_items[1]!.current_end_at = "2026-09-04T19:00:00Z";
    source.affected_items[1]!.coverage_start_at = "2026-09-04T16:00:00Z";
    source.affected_items[1]!.coverage_end_at = "2026-09-04T19:00:00Z";

    const result = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-overlap",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: source,
    });

    expect(
      new Set(
        result.proposal.replacements.map((item) => item.replacement_member_id)
      ).size
    ).toBe(2);
    expect(result.proposal.replacement_member_count).toBe(2);
  });

  it("reports role, history, hours, time off, and schedule conflicts without inventing qualification", () => {
    const source = snapshot();
    source.candidates[0]!.availability_days[0]!.has_time_off = true;
    source.candidates[1]!.roles = [];
    source.candidates[2]!.availability_days[0]!.commitments = [
      {
        kind: "site_visit",
        id: "00000000-0000-4000-8000-000000000099",
        start_at: "2026-09-04T18:30:00Z",
        end_at: "2026-09-04T19:30:00Z",
        source_sha256: HASH_A,
      },
    ];

    const result = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-evidence",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: source,
    });

    expect(result.candidate_assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          member_id: SAM_ID,
          item_assessments: expect.arrayContaining([
            expect.objectContaining({
              item_id: TASK_A,
              state: "unavailable",
              reasons: ["time_off"],
            }),
          ]),
        }),
        expect.objectContaining({
          member_id: ALEX_ID,
          item_assessments: expect.arrayContaining([
            expect.objectContaining({
              item_id: TASK_A,
              state: "unproven",
              reasons: ["role_not_proven"],
            }),
          ]),
        }),
        expect.objectContaining({
          member_id: LEE_ID,
          item_assessments: expect.arrayContaining([
            expect.objectContaining({
              item_id: TASK_A,
              state: "unproven",
              reasons: ["same_task_history_not_proven"],
              qualification_evidence: "same_task_history",
            }),
            expect.objectContaining({
              item_id: TASK_B,
              state: "unavailable",
              reasons: ["schedule_conflict"],
            }),
          ]),
        }),
      ])
    );
    expect(JSON.stringify(result)).not.toMatch(/licensed|certified/i);
  });

  it("falls back to the earliest proven reschedule and drafts only for an exact client", () => {
    const source = snapshot();
    source.candidates = [];
    source.affected_items[0]!.reschedule_options.unshift({
      date: "2026-09-06",
      start_at: "2026-09-06T15:00:00Z",
      end_at: "2026-09-06T17:00:00Z",
      source_sha256: HASH_A,
    });

    const result = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-reschedule",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: source,
    });

    expect(result.proposal.replacements).toEqual([]);
    expect(
      result.proposal.reschedules.map((item) => [
        item.item_id,
        item.proposed_date,
      ])
    ).toEqual([
      [TASK_A, "2026-09-05"],
      [TASK_B, "2026-09-05"],
    ]);
    expect(result.drafts.client).toHaveLength(2);
    expect(result.drafts.client[0]).toEqual(
      expect.objectContaining({
        recipient: expect.objectContaining({ id: CLIENT_ID }),
        body: expect.stringContaining("Nothing has changed yet."),
      })
    );
  });

  it("surfaces uncovered work and a draft blocker when neither coverage nor an exact recipient exists", () => {
    const source = snapshot();
    source.candidates = [];
    source.affected_items = [
      task({
        id: TASK_A,
        projectId: PROJECT_A,
        typeId: TYPE_A,
        title: "Set posts",
        start: "2026-09-04T15:00:00Z",
        end: "2026-09-04T17:00:00Z",
        recipient: false,
        reschedule: false,
      }),
    ];

    const result = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-uncovered",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: source,
    });

    expect(result.proposal.uncovered).toEqual([
      {
        item_id: TASK_A,
        kind: "task",
        reasons: ["no_proven_same_day_cover", "no_safe_reschedule"],
      },
    ]);
    expect(result.drafts.client).toEqual([]);
    expect(result.drafts.blockers).toEqual([
      {
        item_id: TASK_A,
        kind: "client",
        reason: "exact_recipient_unavailable",
      },
    ]);
  });

  it("is host-neutral across source ordering and reports a truthful zero-effect receipt", () => {
    const first = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-stable",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: snapshot(),
    });
    const reversed = snapshot();
    reversed.affected_items.reverse();
    reversed.candidates.reverse();
    reversed.candidates.forEach((row) => {
      row.same_task_history.reverse();
      row.project_ids.reverse();
    });
    const second = prepareCrewCalloutRecoveryPreview({
      requestId: "req-callout-stable",
      input: { crew_member_name: "Mike", target_date: "2026-09-04" },
      snapshot: reversed,
    });

    expect(second).toEqual(first);
    expect(first.preview_receipt).toEqual(
      expect.objectContaining({
        status: "prepared",
        preview_sha256: first.preview_sha256,
      })
    );
    expect(first.effects).toEqual({
      assignment_writes: 0,
      task_writes: 0,
      site_visit_writes: 0,
      calendar_writes: 0,
      ops_draft_writes: 0,
      provider_draft_writes: 0,
      message_writes: 0,
      messages_sent: 0,
    });
    expect(first.facts.company_name.content_kind).toBe(
      "untrusted_business_data"
    );
  });

  it.each([
    [
      "wrong target",
      (value: CrewCalloutRecoverySourceSnapshot) => {
        value.context.target_date = "2026-09-05";
      },
      "INVALID_ARGUMENT",
    ],
    [
      "past target",
      (value: CrewCalloutRecoverySourceSnapshot) => {
        value.context.local_date = "2026-09-05";
      },
      "INVALID_ARGUMENT",
    ],
    [
      "duplicate item",
      (value: CrewCalloutRecoverySourceSnapshot) => {
        value.affected_items.push(value.affected_items[0]!);
      },
      "STALE_CONTEXT",
    ],
    [
      "called-out member missing from task",
      (value: CrewCalloutRecoverySourceSnapshot) => {
        value.affected_items[0]!.assignee_ids = [SAM_ID];
      },
      "STALE_CONTEXT",
    ],
  ])("fails closed for %s", (_label, mutate, code) => {
    const source = snapshot();
    mutate(source);
    try {
      prepareCrewCalloutRecoveryPreview({
        requestId: "req-callout-invalid",
        input: { crew_member_name: "Mike", target_date: "2026-09-04" },
        snapshot: source,
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CrewCalloutRecoveryContractError);
      expect((error as CrewCalloutRecoveryContractError).code).toBe(code);
    }
  });
});
