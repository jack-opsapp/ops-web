import { describe, expect, it } from "vitest";

import {
  GetTaskContextInputSchema,
  GetTaskContextResultSchema,
  ListTasksInputSchema,
  ListTasksResultSchema,
  TASK_CONTEXT_DEFAULT_SECTIONS,
  TASK_READ_MAX_PAGE_ITEMS,
  TASK_READ_MAX_SOURCE_ROWS,
  TASK_READ_SCHEMA_REVISION,
} from "../tasks";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";

const proof = {
  proof_ref: `ops_proof:v1:${"a".repeat(64)}`,
  read_at: "2026-08-23T12:00:00.000Z",
  source_revisions: [
    { domain: "legacy_operational", source_revision: 8 },
    { domain: "tasks", source_revision: 13 },
  ],
} as const;

const evidence = {
  evidence_ref: `ops_evidence:v1:${"b".repeat(64)}`,
  source_domain: "tasks",
  source_type: "task_snapshot",
  occurred_at: proof.read_at,
} as const;

function taskSummary() {
  return {
    task_ref: { kind: "task", id: TASK_ID },
    job_ref: { kind: "project", id: PROJECT_ID },
    job_title: "Carly Hunter deck",
    title: "Install back-deck glass",
    task_type: { state: "recorded", display_name: "Installation" },
    priority: { state: "recorded", rank: 3 },
    state: "active",
    schedule_summary: {
      state: "scheduled",
      starts_on: "2026-08-25",
      ends_on: "2026-08-26",
      confirmation: "current",
    },
    assignees: [
      {
        team_member_ref: { kind: "team_member", id: MEMBER_ID },
        display_name: "Carly Hunter",
        content_kind: "untrusted_business_data",
      },
    ],
    content_kind: "untrusted_business_data",
  } as const;
}

describe("P2 task read inputs", () => {
  it("pins the bounded actionable list default and exact task-detail default sections", () => {
    expect(ListTasksInputSchema.parse({})).toEqual({
      view: { kind: "actionable" },
      limit: 25,
    });
    expect(GetTaskContextInputSchema.parse({ task_ref: TASK_ID })).toEqual({
      task_ref: { kind: "task", id: TASK_ID },
      sections: [...TASK_CONTEXT_DEFAULT_SECTIONS],
    });
    expect(TASK_READ_SCHEMA_REVISION).toBe("2026-08-22.v1");
    expect(TASK_READ_MAX_PAGE_ITEMS).toBe(25);
    expect(TASK_READ_MAX_SOURCE_ROWS).toBe(501);
  });

  it("accepts every closed list view and keeps schedule filtering explicit", () => {
    const views = [
      { kind: "all" },
      { kind: "job", job_ref: { kind: "project", id: PROJECT_ID } },
      {
        kind: "assignee",
        assignee_ref: { kind: "team_member", id: MEMBER_ID },
      },
      { kind: "status", states: ["active", "completed"] },
      {
        kind: "schedule_window",
        starts_at: "2026-08-23T00:00:00.000Z",
        ends_before: "2026-09-01T00:00:00.000Z",
      },
      { kind: "overdue", as_of: "2026-08-23T12:00:00.000Z" },
      { kind: "unassigned" },
      { kind: "actionable" },
    ] as const;

    for (const view of views) {
      expect(ListTasksInputSchema.safeParse({ view }).success).toBe(true);
    }
  });

  it("rejects open views, duplicate states, invalid windows, unknown detail sections, and caller authority", () => {
    const invalid: unknown[] = [
      { view: { kind: "search", query: "glass" } },
      { view: { kind: "status", states: ["active", "active"] } },
      {
        view: {
          kind: "schedule_window",
          starts_at: "2026-09-01T00:00:00.000Z",
          ends_before: "2026-08-23T00:00:00.000Z",
        },
      },
      {
        task_ref: TASK_ID,
        sections: ["dependencies", "payroll"],
      },
      { task_ref: TASK_ID, actor_user_id: MEMBER_ID },
      { task_ref: TASK_ID, company_id: PROJECT_ID },
      { task_ref: TASK_ID, sections: ["notes", "notes"] },
    ];

    for (const value of invalid) {
      const schema =
        typeof value === "object" && value !== null && "task_ref" in value
          ? GetTaskContextInputSchema
          : ListTasksInputSchema;
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});

describe("P2 task read results", () => {
  it("accepts a canonical list with safe team display, task/job refs, proof, and signed continuation", () => {
    const parsed = ListTasksResultSchema.parse({
      items: [taskSummary()],
      item_proofs: [{ ...proof, proof_ref: `ops_proof:v1:${"c".repeat(64)}` }],
      evidence: [evidence],
      next_cursor: "opaque.signed.cursor",
      collection_proof: {
        ...proof,
        returned_count: 1,
        has_more: true,
      },
    });

    expect(parsed.items[0]?.assignees[0]).toEqual(
      expect.not.objectContaining({ email: expect.anything() })
    );
    expect(Object.isFrozen(parsed)).toBe(false);
  });

  it("accepts explicit notes, schedule, finance identity, readiness, dependencies, blockers, and evidence state", () => {
    expect(
      GetTaskContextResultSchema.parse({
        task: taskSummary(),
        blocker_codes: ["MATERIAL_SHORTAGE", "SCHEDULE_UNCONFIRMED"],
        sections: {
          dependencies: {
            state: "blocked",
            source_count: 1,
            dependencies: [
              {
                task_ref: {
                  kind: "task",
                  id: "44444444-4444-4444-8444-444444444444",
                },
                title: "Set posts",
                state: "active",
                content_kind: "untrusted_business_data",
              },
            ],
          },
          material_readiness: {
            state: "shortage",
            required_line_count: 2,
            shortage_line_count: 1,
            invalid_line_count: 0,
          },
          evidence_state: { state: "recorded", evidence_count: 2 },
          schedule: {
            state: "scheduled",
            starts_at: "2026-08-25T15:00:00.000Z",
            ends_at: "2026-08-25T23:00:00.000Z",
            all_day: false,
            schedule_version: 7,
            confirmation: "stale",
            confirmed_schedule_version: 6,
            confirmed_at: "2026-08-20T16:00:00.000Z",
          },
          notes: {
            state: "recorded",
            text: "Customer marked the back deck as glass.",
            truncated: false,
            content_kind: "untrusted_business_data",
          },
          financial_origin: {
            state: "estimate_line",
            estimate_ref: {
              kind: "estimate",
              id: "55555555-5555-4555-8555-555555555555",
            },
            line_item_ref: {
              kind: "estimate_line_item",
              id: "66666666-6666-4666-8666-666666666666",
            },
          },
        },
        evidence: [evidence],
        proof,
      })
    ).toBeTruthy();
  });

  it("rejects private staff fields, hidden financial identity, raw material identity, open blockers, malformed ordering, and proof drift", () => {
    const base = {
      task: taskSummary(),
      blocker_codes: [],
      sections: {
        dependencies: {
          state: "no_dependencies",
          source_count: 0,
          dependencies: [],
        },
        material_readiness: {
          state: "not_required",
          required_line_count: 0,
          shortage_line_count: 0,
          invalid_line_count: 0,
        },
        evidence_state: { state: "not_recorded" },
      },
      evidence: [evidence],
      proof,
    } as const;

    const invalid: unknown[] = [
      {
        ...base,
        task: {
          ...base.task,
          assignees: [
            { ...base.task.assignees[0], email: "carly@example.com" },
          ],
        },
      },
      {
        ...base,
        task: { ...base.task, source_estimate_id: "secret" },
      },
      {
        ...base,
        sections: {
          ...base.sections,
          material_readiness: {
            ...base.sections.material_readiness,
            catalog_variant_id: MEMBER_ID,
          },
        },
      },
      { ...base, blocker_codes: ["ASK_MANAGER"] },
      {
        ...base,
        task: {
          ...base.task,
          assignees: [
            {
              ...base.task.assignees[0],
              team_member_ref: {
                kind: "team_member",
                id: "77777777-7777-4777-8777-777777777777",
              },
            },
            base.task.assignees[0],
          ],
        },
      },
      {
        ...base,
        proof: {
          ...proof,
          source_revisions: [{ domain: "tasks", source_revision: 13 }],
        },
      },
      {
        ...base,
        sections: {
          ...base.sections,
          material_readiness: {
            state: "ready",
            required_line_count: 0,
            shortage_line_count: 0,
            invalid_line_count: 0,
          },
        },
      },
      {
        ...base,
        sections: {
          ...base.sections,
          material_readiness: {
            state: "not_tracked",
            required_line_count: 1,
            shortage_line_count: 0,
            invalid_line_count: 1,
          },
        },
      },
    ];

    for (const value of invalid) {
      expect(GetTaskContextResultSchema.safeParse(value).success).toBe(false);
    }
  });
});
