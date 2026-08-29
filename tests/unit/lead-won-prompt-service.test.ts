import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type QueryResult = { data: unknown; error: { message: string } | null };

  const tableResults = new Map<string, QueryResult[]>();
  const selectCalls: Array<{
    table: string;
    columns: string;
    filters: Array<[string, string, unknown]>;
  }> = [];
  const updateCalls: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Array<[string, string, unknown]>;
  }> = [];
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  let rpcResult: QueryResult = { data: null, error: null };
  let updateResult: QueryResult = { data: null, error: null };

  function nextResult(table: string): QueryResult {
    const queue = tableResults.get(table) ?? [];
    const next = queue.shift();
    return next ?? { data: null, error: { message: `no queued result for ${table}` } };
  }

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call = { table, columns, filters: [] as Array<[string, string, unknown]> };
          selectCalls.push(call);
          const builder = {
            eq(column: string, value: unknown) {
              call.filters.push(["eq", column, value]);
              return builder;
            },
            is(column: string, value: unknown) {
              call.filters.push(["is", column, value]);
              return builder;
            },
            maybeSingle() {
              return Promise.resolve(nextResult(table));
            },
          };
          return builder;
        },
        update(values: Record<string, unknown>) {
          const call = { table, values, filters: [] as Array<[string, string, unknown]> };
          const thenable = {
            eq(column: string, value: unknown) {
              call.filters.push(["eq", column, value]);
              return thenable;
            },
            is(column: string, value: unknown) {
              call.filters.push(["is", column, value]);
              return thenable;
            },
            then(
              resolve: (value: QueryResult) => unknown,
              reject?: (reason: unknown) => unknown
            ) {
              updateCalls.push(call);
              return Promise.resolve(updateResult).then(resolve, reject);
            },
          };
          return thenable;
        },
      };
    },
    rpc(fn: string, params: Record<string, unknown>) {
      rpcCalls.push({ fn, params });
      return Promise.resolve(rpcResult);
    },
  };

  return {
    client,
    tableResults,
    selectCalls,
    updateCalls,
    rpcCalls,
    setRpcResult(result: QueryResult) {
      rpcResult = result;
    },
    setUpdateResult(result: QueryResult) {
      updateResult = result;
    },
    reset() {
      tableResults.clear();
      selectCalls.length = 0;
      updateCalls.length = 0;
      rpcCalls.length = 0;
      rpcResult = { data: null, error: null };
      updateResult = { data: null, error: null };
    },
  };
});

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => harness.client,
}));

import { LeadWonPromptService } from "@/lib/api/services/lead-won-prompt-service";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { ProjectStatus } from "@/lib/types/models";
import type { PermissionScope } from "@/lib/types/permissions";
import { useLeadWonPromptStore } from "@/stores/lead-won-prompt-store";

const USER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const OPP_ID = "cccccccc-0000-4000-8000-000000000003";

function setPipelineScopes(scope: PermissionScope) {
  usePermissionStore.setState({
    permissions: new Map<string, PermissionScope>([
      ["pipeline.view", scope],
      ["pipeline.edit", scope],
    ]),
    configuredPermissions: new Set(["pipeline.view", "pipeline.edit"]),
  });
}

function queueProjectRow(link: string | null) {
  harness.tableResults.set("projects", [
    { data: link ? { opportunity_ref: link, opportunity_id: link } : { opportunity_ref: null, opportunity_id: null }, error: null },
  ]);
}

function queueOpportunityRow(overrides: Record<string, unknown> = {}) {
  harness.tableResults.set("opportunities", [
    {
      data: {
        id: OPP_ID,
        stage: "quoted",
        assigned_to: null,
        archived_at: null,
        deleted_at: null,
        title: "Calloway re-roof",
        contact_name: "Dana Calloway",
        won_prompt_declined_at: null,
        ...overrides,
      },
      error: null,
    },
  ]);
}

beforeEach(() => {
  harness.reset();
  useLeadWonPromptStore.setState({
    pending: null,
    queue: [],
    answered: new Set<string>(),
  });
  useAuthStore.setState({
    currentUser: { id: USER_ID } as never,
  });
  setPipelineScopes("all");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LeadWonPromptService.propose", () => {
  it("does not touch the network for non-proposing statuses", async () => {
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Estimated);
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Archived);
    expect(harness.selectCalls).toEqual([]);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
  });

  it("enqueues a proposal for an open, editable, linked lead", async () => {
    queueProjectRow(OPP_ID);
    queueOpportunityRow();
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);

    const pending = useLeadWonPromptStore.getState().pending;
    expect(pending).toEqual({
      opportunityId: OPP_ID,
      projectId: PROJECT_ID,
      leadLabel: "Calloway re-roof",
      userId: USER_ID,
    });

    expect(harness.selectCalls[0]?.table).toBe("projects");
    expect(harness.selectCalls[0]?.filters).toContainEqual(["eq", "id", PROJECT_ID]);
    expect(harness.selectCalls[1]?.table).toBe("opportunities");
    expect(harness.selectCalls[1]?.filters).toContainEqual(["eq", "id", OPP_ID]);
    expect(harness.selectCalls[1]?.filters).toContainEqual(["is", "deleted_at", null]);
  });

  it("stays silent for unlinked projects and legacy non-uuid links", async () => {
    queueProjectRow(null);
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
    expect(harness.selectCalls).toHaveLength(1);

    harness.reset();
    queueProjectRow("LEGACY-TEXT-ID");
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
    expect(harness.selectCalls).toHaveLength(1);
  });

  it("stays silent when the lead row is invisible, declined, terminal, or fetch fails", async () => {
    queueProjectRow(OPP_ID);
    harness.tableResults.set("opportunities", [{ data: null, error: null }]);
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();

    harness.reset();
    queueProjectRow(OPP_ID);
    queueOpportunityRow({ won_prompt_declined_at: "2026-08-20T10:00:00Z" });
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();

    harness.reset();
    queueProjectRow(OPP_ID);
    queueOpportunityRow({ stage: "won" });
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();

    harness.reset();
    queueProjectRow(OPP_ID);
    harness.tableResults.set("opportunities", [
      { data: null, error: { message: "column does not exist" } },
    ]);
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
  });

  it("never proposes without lead-edit authority (assigned scope, foreign lead)", async () => {
    setPipelineScopes("assigned");
    queueProjectRow(OPP_ID);
    queueOpportunityRow({ assigned_to: "dddddddd-0000-4000-8000-000000000009" });
    await LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted);
    expect(useLeadWonPromptStore.getState().pending).toBeNull();
  });

  it("never rejects, even when everything is on fire", async () => {
    harness.tableResults.set("projects", [
      { data: null, error: { message: "network down" } },
    ]);
    await expect(
      LeadWonPromptService.propose(PROJECT_ID, ProjectStatus.Accepted)
    ).resolves.toBeUndefined();
  });
});

describe("LeadWonPromptService.winLinkedOpportunity", () => {
  it("calls the guarded RPC with the exact contract params", async () => {
    await LeadWonPromptService.winLinkedOpportunity({
      opportunityId: OPP_ID,
      projectId: PROJECT_ID,
      leadLabel: "Calloway re-roof",
      userId: USER_ID,
    });
    expect(harness.rpcCalls).toEqual([
      {
        fn: "win_linked_opportunity",
        params: {
          p_opportunity_id: OPP_ID,
          p_project_id: PROJECT_ID,
          p_user_id: USER_ID,
        },
      },
    ]);
  });

  it("throws on RPC failure so the host can toast", async () => {
    harness.setRpcResult({ data: null, error: { message: "opportunity_stage_terminal" } });
    await expect(
      LeadWonPromptService.winLinkedOpportunity({
        opportunityId: OPP_ID,
        projectId: PROJECT_ID,
        leadLabel: null,
        userId: USER_ID,
      })
    ).rejects.toThrow(/opportunity_stage_terminal/);
  });
});

describe("LeadWonPromptService.declineWonPrompt", () => {
  it("records the decline once — filtered to still-null won_prompt_declined_at", async () => {
    await LeadWonPromptService.declineWonPrompt({
      opportunityId: OPP_ID,
      projectId: PROJECT_ID,
      leadLabel: null,
      userId: USER_ID,
    });
    expect(harness.updateCalls).toHaveLength(1);
    const call = harness.updateCalls[0];
    expect(call.table).toBe("opportunities");
    expect(call.values.won_prompt_declined_by).toBe(USER_ID);
    expect(typeof call.values.won_prompt_declined_at).toBe("string");
    expect(
      Number.isNaN(Date.parse(call.values.won_prompt_declined_at as string))
    ).toBe(false);
    expect(call.filters).toContainEqual(["eq", "id", OPP_ID]);
    expect(call.filters).toContainEqual(["is", "won_prompt_declined_at", null]);
  });

  it("throws on update failure (the host tolerates it silently)", async () => {
    harness.setUpdateResult({ data: null, error: { message: "permission denied" } });
    await expect(
      LeadWonPromptService.declineWonPrompt({
        opportunityId: OPP_ID,
        projectId: PROJECT_ID,
        leadLabel: null,
        userId: USER_ID,
      })
    ).rejects.toThrow(/permission denied/);
  });
});
