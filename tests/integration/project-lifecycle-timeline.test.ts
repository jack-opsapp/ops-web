/**
 * Integration tests for ProjectLifecycleService.onProjectStageChange's
 * timeline + notification-dispatch wiring (Phase 11.1).
 *
 * Verifies that on a status transition:
 *   1. A project_notes row is inserted with event_kind='status_change' and
 *      content_metadata = { from, to }.
 *   2. dispatchProjectStatusChange is called once with the project's
 *      team_member_ids minus the changedBy user.
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

interface DispatchStatusChangeCall {
  projectId: string;
  projectTitle: string;
  fromStatus: string;
  toStatus: string;
  changedByName: string;
  recipientUserIds: string[];
  companyId: string;
}
const statusDispatches: DispatchStatusChangeCall[] = [];

vi.mock("@/lib/api/services/notification-dispatch", () => ({
  dispatchProjectStatusChange: (params: DispatchStatusChangeCall) => {
    statusDispatches.push(params);
  },
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
  statusDispatches.length = 0;
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

  it("dispatches status-change notification to team minus the changedBy user", async () => {
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
    );

    expect(statusDispatches).toHaveLength(1);
    const call = statusDispatches[0];
    expect(call.projectId).toBe("p-1");
    expect(call.projectTitle).toBe("Roof Replacement");
    expect(call.fromStatus).toBe("rfq");
    expect(call.toStatus).toBe("estimated");
    expect(call.changedByName).toBe("Operator One");
    expect(call.companyId).toBe("co-1");
    expect(call.recipientUserIds.sort()).toEqual(["u-2", "u-3"]);
  });

  it("does not dispatch when team has only the changedBy user", async () => {
    supabaseStub = makeSupabaseStub({ teamMemberIds: ["u-1"] });

    await ProjectLifecycleService.onProjectStageChange(
      "co-1",
      "p-1",
      "estimated",
      "accepted",
      "u-1",
      "Solo Operator",
    );

    expect(systemEvents).toHaveLength(1);
    expect(statusDispatches).toHaveLength(0);
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
    expect(statusDispatches).toHaveLength(0);
  });
});
