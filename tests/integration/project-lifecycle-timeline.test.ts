/**
 * Integration tests for ProjectLifecycleService.onProjectStageChange's
 * timeline + notification-dispatch wiring (Phase 11.1).
 *
 * Verifies that on a status transition:
 *   1. A project_notes row is inserted with event_kind='status_change' and
 *      content_metadata = { from, to }.
 *   2. the canonical server notification dispatcher receives only the
 *      immutable lifecycle event id and authenticated actor.
 *
 * The project_notes write + dispatch must fire regardless of the phase_c
 * AI feature gate — they are the audit trail / team awareness pathway and
 * must always run on a real status change.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

interface SystemEventCall {
  projectId: string;
  companyId: string;
  authorId: string;
  eventKind: string;
  content: string;
  contentMetadata: Record<string, unknown> | null;
}
const systemEvents: SystemEventCall[] = [];

vi.mock("@/lib/api/services/project-note-service", () => ({
  ProjectNoteService: {
    createSystemEvent: (input: SystemEventCall) => {
      systemEvents.push(input);
      return Promise.resolve({ id: `note-${systemEvents.length}` });
    },
  },
}));

const dispatchNotificationEvent = vi.fn((_input: unknown) =>
  Promise.resolve({ ok: true, notified: 2, pushed: 2, emailed: 0 } as const)
);

vi.mock("@/lib/notifications/dispatch-notification-event", () => ({
  dispatchNotificationEvent: (input: unknown) =>
    dispatchNotificationEvent(input),
}));

// AI feature gate — returns false so the lifecycle service short-circuits
// AFTER writing the timeline event + dispatching the notification.
vi.mock("@/lib/api/services/admin-feature-override-service", () => ({
  AdminFeatureOverrideService: {
    isAIFeatureEnabled: () => Promise.resolve(false),
  },
}));

// Stub the supabase helper. The lifecycle service uses requireSupabase()
// inline for its admin-id lookup + (when phase_c is on) task-pattern
// queries. Only the admin lookup runs in this test path.
function makeSupabaseStub(opts: {
  adminIds?: string;
  projectTitle?: string;
  teamMemberIds?: string[];
}) {
  const { adminIds = "admin-1", projectTitle = "Test Project", teamMemberIds = [] } = opts;

  return {
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { admin_ids: adminIds }, error: null }),
              // getCompanyManagerUserIds (the P4-5 role-name-free admin
              // resolver) reads account_holder_id ∪ admin_ids via maybeSingle.
              maybeSingle: () =>
                Promise.resolve({
                  data: { account_holder_id: "admin-1", admin_ids: adminIds },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: "p-1",
                    title: projectTitle,
                    company_id: "co-1",
                    team_member_ids: teamMemberIds,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "project_notes") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.contains = () => builder;
        builder.maybeSingle = () =>
          Promise.resolve({ data: null, error: null });
        return builder;
      }
      if (table === "users") {
        // Used by admin fallback if companies.admin_ids is empty
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                eq: () => ({
                  is: () => ({
                    limit: () =>
                      Promise.resolve({ data: [{ id: "admin-fallback" }], error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
  };
}

let supabaseStub = makeSupabaseStub({});
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => supabaseStub,
  parseDate: (v: string | null) => (v ? new Date(v) : null),
  parseDateRequired: (v: string) => new Date(v),
}));

// Block any dynamic-import side trips into invoice-suggestion / approval-queue
// in case the phase_c gate were to flip. Not strictly needed since the gate
// returns false here, but defensive.
vi.mock("@/lib/api/services/invoice-suggestion-service", () => ({
  InvoiceSuggestionService: {
    suggestInvoiceFromCompletion: () => Promise.resolve(),
  },
}));

import { ProjectLifecycleService } from "@/lib/api/services/project-lifecycle-service";

beforeEach(() => {
  systemEvents.length = 0;
  dispatchNotificationEvent.mockClear();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ProjectLifecycleService.onProjectStageChange — timeline + dispatch", () => {
  it("writes a status_change project_notes row with from/to metadata", async () => {
    supabaseStub = makeSupabaseStub({
      teamMemberIds: ["u-1", "u-2", "u-3"],
    });

    await ProjectLifecycleService.onProjectStageChange(
      "co-1",
      "p-1",
      "rfq",
      "estimated",
      "u-1",
      "Operator One",
    );

    expect(systemEvents).toHaveLength(1);
    const ev = systemEvents[0];
    expect(ev.projectId).toBe("p-1");
    expect(ev.companyId).toBe("co-1");
    expect(ev.eventKind).toBe("status_change");
    expect(ev.contentMetadata).toEqual({ from: "rfq", to: "estimated" });
  });

  it("dispatches status-change notification through the trusted server seam", async () => {
    supabaseStub = makeSupabaseStub({
      teamMemberIds: ["u-1", "u-2", "u-3"],
      projectTitle: "Roof Replacement",
    });

    await ProjectLifecycleService.onProjectStageChange(
      "co-1",
      "p-1",
      "rfq",
      "estimated",
      "u-1",
      "Operator One",
      "00000000-0000-4000-8000-000000000001"
    );

    expect(dispatchNotificationEvent).toHaveBeenCalledTimes(1);
    expect(dispatchNotificationEvent).toHaveBeenCalledWith({
      db: supabaseStub,
      actor: {
        userId: "u-1",
        companyId: "co-1",
        name: "Operator One",
      },
      request: {
        eventType: "project_status_change",
        projectId: "p-1",
        projectStatusEventId: "00000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("lets the server resolver decide whether any recipients remain", async () => {
    supabaseStub = makeSupabaseStub({ teamMemberIds: ["u-1"] });

    await ProjectLifecycleService.onProjectStageChange(
      "co-1",
      "p-1",
      "estimated",
      "accepted",
      "u-1",
      "Solo Operator",
      "00000000-0000-4000-8000-000000000002"
    );

    expect(systemEvents).toHaveLength(1);
    expect(dispatchNotificationEvent).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when changedByUserId is omitted (legacy callers)", async () => {
    supabaseStub = makeSupabaseStub({ teamMemberIds: ["u-1", "u-2"] });

    await ProjectLifecycleService.onProjectStageChange(
      "co-1",
      "p-1",
      "estimated",
      "accepted",
    );

    // Timeline event still writes (the audit trail does not require a known actor),
    // but we cannot dispatch without knowing who changed the status.
    expect(systemEvents).toHaveLength(1);
    expect(dispatchNotificationEvent).not.toHaveBeenCalled();
  });
});
