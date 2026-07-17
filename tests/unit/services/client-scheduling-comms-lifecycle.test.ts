import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const MEMBER_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_MEMBER_ID = "88888888-8888-4888-8888-888888888888";

const mocks = vi.hoisted(() => ({
  requireSupabase: vi.fn(),
  isAIFeatureEnabled: vi.fn(),
  proposeAction: vi.fn(),
  generateDraft: vi.fn(),
  ensureApprovalDraftHistory: vi.fn(),
  resolveConnection: vi.fn(),
  getCompanyLocale: vi.fn(),
  renderServerString: vi.fn(),
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: mocks.requireSupabase,
}));
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: mocks.isAIFeatureEnabled,
  },
}));
vi.mock("@/lib/api/services/approval-queue-service", () => ({
  ApprovalQueueService: { proposeAction: mocks.proposeAction },
}));
vi.mock("@/lib/api/services/ai-draft-service", () => ({
  AIDraftService: { generateDraft: mocks.generateDraft },
}));
vi.mock("@/lib/api/services/approval-draft-provenance", () => ({
  ensureApprovalDraftHistory: mocks.ensureApprovalDraftHistory,
}));
vi.mock("@/lib/email/email-connection-selection", () => ({
  resolveNewEmailConversationConnectionId: mocks.resolveConnection,
}));
vi.mock("@/i18n/server-render", () => ({
  getCompanyLocale: mocks.getCompanyLocale,
  renderServerString: mocks.renderServerString,
}));

import {
  buildScheduleChangeDetails,
  ClientSchedulingCommsService,
  scheduleChangeFingerprint,
  type ConfirmedScheduleChange,
} from "@/lib/api/services/client-scheduling-comms-service";

type QueryResult = { data: unknown; error: unknown };

function fakeSupabase(results: QueryResult[]) {
  const updates: Array<Record<string, unknown>> = [];
  const filters: Array<Array<[string, unknown]>> = [];
  const builders = results.map((result) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    const ownFilters: Array<[string, unknown]> = [];
    filters.push(ownFilters);
    builder.select = vi.fn(() => builder);
    builder.update = vi.fn((value: Record<string, unknown>) => {
      updates.push(value);
      return builder;
    });
    builder.eq = vi.fn((column: string, value: unknown) => {
      ownFilters.push([column, value]);
      return builder;
    });
    builder.is = vi.fn((column: string, value: unknown) => {
      ownFilters.push([column, value]);
      return builder;
    });
    builder.not = vi.fn((column: string, operator: string, value: unknown) => {
      ownFilters.push([`${column}:not:${operator}`, value]);
      return builder;
    });
    builder.in = vi.fn(() => builder);
    builder.single = vi.fn(async () => result);
    builder.maybeSingle = vi.fn(async () => result);
    builder.then = vi.fn(
      (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(result).then(onFulfilled, onRejected)
    );
    return builder;
  });

  return {
    client: {
      from: vi.fn(() => {
        const next = builders.shift();
        if (!next) throw new Error("Unexpected database query");
        return next;
      }),
    },
    updates,
    filters,
  };
}

function change(overrides: Partial<ConfirmedScheduleChange> = {}) {
  return {
    before: {
      startDate: "2026-07-21T16:00:00.000Z",
      endDate: null,
      startTime: "08:00:00",
      endTime: "16:00:00",
      allDay: false,
      duration: 1,
      teamMemberIds: [MEMBER_ID],
    },
    after: {
      startDate: "2026-07-21T16:00:00.000Z",
      endDate: null,
      startTime: "09:00:00",
      endTime: "17:00:00",
      allDay: false,
      duration: 1,
      teamMemberIds: [OTHER_MEMBER_ID],
    },
    scheduleVersion: 7,
    ...overrides,
  } satisfies ConfirmedScheduleChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.isAIFeatureEnabled.mockResolvedValue(true);
  mocks.proposeAction.mockResolvedValue("action-1");
  mocks.generateDraft.mockResolvedValue({
    available: true,
    draft: "The visit is no longer scheduled.",
    draftHistoryId: "draft-history-1",
  });
  mocks.ensureApprovalDraftHistory.mockResolvedValue("draft-history-1");
  mocks.resolveConnection.mockResolvedValue("connection-1");
  mocks.getCompanyLocale.mockResolvedValue("en");
  mocks.renderServerString.mockImplementation(
    async (_locale: string, _namespace: string, key: string) => key
  );
});

describe("schedule-change proposal facts", () => {
  it("describes time and crew changes without inventing a date change", () => {
    const details = buildScheduleChangeDetails(
      change(),
      ["Jason"],
      ["Luke"],
      "en-US"
    ).join(" ");

    expect(details).toContain("original time");
    expect(details).toContain("8:00 AM");
    expect(details).toContain("new time");
    expect(details).toContain("9:00 AM");
    expect(details).toContain("Jason");
    expect(details).toContain("Luke");
    expect(details).not.toContain("original date");
    expect(details).not.toContain("new date");
  });

  it("keys idempotency to the complete before/after schedule, not only the date", () => {
    const timeChange = change();
    const crewChange = change({
      after: {
        ...change().after,
        startTime: "08:00:00",
        endTime: "16:00:00",
      },
    });

    expect(scheduleChangeFingerprint(timeChange)).not.toBe(
      scheduleChangeFingerprint(crewChange)
    );
    expect(scheduleChangeFingerprint(timeChange)).toBe(
      scheduleChangeFingerprint({
        ...timeChange,
        before: {
          ...timeChange.before,
          teamMemberIds: [...timeChange.before.teamMemberIds].reverse(),
        },
      })
    );
  });

  it("describes a cleared confirmed date as unscheduled without inventing a replacement", () => {
    const unscheduled = change({
      after: {
        ...change().after,
        startDate: null,
        endDate: null,
        startTime: null,
        endTime: null,
      },
    });

    const details = buildScheduleChangeDetails(
      unscheduled,
      ["Jason"],
      ["Jason"],
      "en-US"
    ).join(" ");

    expect(details).toContain("is no longer scheduled");
    expect(details).not.toContain("The new date is");
    expect(details).not.toContain("not specified");
  });
});

describe("confirmed schedule removal", () => {
  it("dispatches the configured draft path when a confirmed date is cleared", async () => {
    const unscheduled = change({
      after: {
        ...change().after,
        startDate: null,
        endDate: null,
        startTime: null,
        endTime: null,
      },
    });
    const fake = fakeSupabase([
      {
        data: {
          id: TASK_ID,
          start_date: null,
          end_date: null,
          start_time: null,
          end_time: null,
          all_day: false,
          duration: 1,
          team_member_ids: [OTHER_MEMBER_ID],
          schedule_version: unscheduled.scheduleVersion,
          schedule_confirmed_at: "2026-07-20T10:00:00.000Z",
        },
        error: null,
      },
      {
        data: {
          client_comms_settings: {
            appointment_confirmation: { reschedule_behavior: "draft" },
          },
        },
        error: null,
      },
    ]);
    mocks.requireSupabase.mockReturnValue(fake.client);
    const dispatch = vi
      .spyOn(ClientSchedulingCommsService, "sendScheduleChangedEmail")
      .mockResolvedValueOnce("action-1");

    await expect(
      ClientSchedulingCommsService.onConfirmedTaskRescheduled(
        COMPANY_ID,
        ACTOR_ID,
        TASK_ID,
        unscheduled
      )
    ).resolves.toEqual({ actionTaken: "draft", actionId: "action-1" });

    expect(dispatch).toHaveBeenCalledWith(
      COMPANY_ID,
      ACTOR_ID,
      TASK_ID,
      unscheduled,
      {}
    );
  });

  it("persists an explicit unscheduled client draft with no replacement date", async () => {
    const unscheduled = change({
      after: {
        ...change().after,
        startDate: null,
        endDate: null,
        startTime: null,
        endTime: null,
        teamMemberIds: [MEMBER_ID],
      },
    });
    const task = {
      id: TASK_ID,
      project_id: "project-1",
      custom_title: "Frame addition",
      start_date: null,
      end_date: null,
      start_time: null,
      end_time: null,
      all_day: false,
      duration: 1,
      team_member_ids: [MEMBER_ID],
      schedule_version: unscheduled.scheduleVersion,
      task_types: { display: "Framing" },
    };
    const fake = fakeSupabase([
      {
        data: {
          client_comms_settings: {
            appointment_confirmation: { level: "draft_on_confirm" },
          },
        },
        error: null,
      },
      { data: task, error: null },
      {
        data: {
          id: "project-1",
          title: "Addition",
          address: "1 Main St",
          client_id: "client-1",
        },
        error: null,
      },
      {
        data: { id: "client-1", name: "Taylor", email: "t@example.com" },
        error: null,
      },
      {
        data: [{ id: MEMBER_ID, first_name: "Jason", last_name: "Z" }],
        error: null,
      },
      { data: task, error: null },
    ]);
    mocks.requireSupabase.mockReturnValue(fake.client);

    await expect(
      ClientSchedulingCommsService.sendScheduleChangedEmail(
        COMPANY_ID,
        ACTOR_ID,
        TASK_ID,
        unscheduled,
        { sourceId: "task-automation:event-1:confirmed-reschedule" }
      )
    ).resolves.toBe("action-1");

    expect(mocks.generateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        userInstruction: expect.stringContaining("no longer scheduled"),
      })
    );
    const proposal = mocks.proposeAction.mock.calls[0][0];
    expect(proposal).toMatchObject({
      actionType: "send_schedule_changed",
      sourceId: "task-automation:event-1:confirmed-reschedule",
      actionData: {
        change_kind: "unscheduled",
        original_date: unscheduled.before.startDate,
        new_date: null,
        new_time: null,
        new_end_time: null,
      },
    });
    expect(proposal.actionData.draft_text).not.toContain("replacement date");
  });
});

describe("full-auto durable persistence", () => {
  it("fails closed unless the worker supplies a fenced durable lease", async () => {
    const fake = fakeSupabase([
      {
        data: {
          client_comms_settings: {
            appointment_confirmation: { level: "full_auto" },
          },
        },
        error: null,
      },
    ]);
    mocks.requireSupabase.mockReturnValue(fake.client);

    await expect(
      ClientSchedulingCommsService.onTaskCreatedMaybeFullAuto(
        COMPANY_ID,
        ACTOR_ID,
        TASK_ID
      )
    ).rejects.toThrow("Full-auto confirmation requires a durable task lease");

    expect(fake.updates).toEqual([]);
  });

  it("passes the durable guard through and never performs a JS marker rollback", async () => {
    const expected = change();
    const guard = {
      eventId: "event-1",
      leaseToken: "lease-1",
      taskId: TASK_ID,
      scheduleVersion: 7,
    };
    const fake = fakeSupabase([
      {
        data: {
          client_comms_settings: {
            appointment_confirmation: { level: "full_auto" },
          },
        },
        error: null,
      },
      {
        data: {
          start_date: expected.after.startDate,
          end_date: expected.after.endDate,
          start_time: expected.after.startTime,
          end_time: expected.after.endTime,
          all_day: expected.after.allDay,
          duration: expected.after.duration,
          team_member_ids: expected.after.teamMemberIds,
          schedule_version: expected.scheduleVersion,
        },
        error: null,
      },
    ]);
    mocks.requireSupabase.mockReturnValue(fake.client);
    const dispatch = vi
      .spyOn(ClientSchedulingCommsService, "onTaskScheduleConfirmed")
      .mockRejectedValueOnce(new Error("proposal failed"));

    await expect(
      ClientSchedulingCommsService.onTaskCreatedMaybeFullAuto(
        COMPANY_ID,
        ACTOR_ID,
        TASK_ID,
        {
          sourceId: "task-automation:event-1:full-auto",
          expectedSchedule: expected,
          taskAutomationGuard: guard,
        }
      )
    ).rejects.toThrow("proposal failed");

    expect(dispatch).toHaveBeenCalledWith(
      COMPANY_ID,
      ACTOR_ID,
      TASK_ID,
      expect.objectContaining({
        sourceId: "task-automation:event-1:full-auto",
        expectedSchedule: expected.after,
        taskAutomationGuard: guard,
      })
    );
    expect(fake.updates).toEqual([]);
  });
});
