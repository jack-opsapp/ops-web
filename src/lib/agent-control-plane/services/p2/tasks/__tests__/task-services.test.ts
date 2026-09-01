import { describe, expect, it } from "vitest";

import type { GetTaskContextResult } from "@/lib/agent-control-plane/contracts/tasks";

import { measureP2SerializedCharacters } from "../../shared/result-budget";
import { createTaskListCursorService } from "../task-cursor";
import { createSupabaseTaskReadRepository } from "../task-repository";
import { getTaskContext, listTasks, TaskReadError } from "../task-reads";
import {
  taskContextEntityProofRef,
  taskContextEvidenceRef,
  taskContextProofContext,
  taskListCollectionProofRef,
  taskListEntityProofRef,
  taskListEvidenceRef,
  taskListProofContext,
} from "../task-proof";
import {
  listTasksAuthorization,
  taskContextAuthorization,
  taskSummary,
  TASK_ACTOR_ID,
  TASK_CLIENT_ID,
  TASK_COMPANY_ID,
  TASK_GRANT_ID,
  TASK_ID,
  TASK_PERMISSION_REVISION,
  TASK_READ_AT,
  TASK_SOURCE_REVISIONS,
} from "./task-fixtures";

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];
  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}
  rpc(functionName: string, args: Record<string, unknown>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected RPC");
    return Promise.resolve(next);
  }
}

type ListAuthorization = Awaited<ReturnType<typeof listTasksAuthorization>>;
type DetailAuthorization = Awaited<ReturnType<typeof taskContextAuthorization>>;

function binding(authorization: ListAuthorization | DetailAuthorization) {
  return {
    company_id: TASK_COMPANY_ID,
    actor_user_id: TASK_ACTOR_ID,
    oauth_grant_id: TASK_GRANT_ID,
    oauth_client_id: TASK_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: TASK_PERMISSION_REVISION,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    required_oauth_scopes: [...authorization.requiredOAuthScopes],
    tasks_scope: authorization.tasksScope,
    projects_scope: authorization.projectsScope,
    calendar_scope: authorization.calendarScope,
    estimates_scope: authorization.estimatesScope,
    project_financials_scope: authorization.projectFinancialsScope,
    read_at: TASK_READ_AT,
    source_revisions: TASK_SOURCE_REVISIONS,
  } as const;
}

function listRaw(authorization: ListAuthorization) {
  const item = taskSummary();
  const context = taskListProofContext({
    authorization,
    cursor: null,
    readAt: TASK_READ_AT,
    sourceRevisions: TASK_SOURCE_REVISIONS,
    sourceInspected: 2,
    sourceHasMore: true,
  });
  const proofRef = taskListEntityProofRef({
    context,
    task: item,
    priorityRankText: "3",
  });
  const evidenceRef = taskListEvidenceRef({
    context,
    taskRef: item.task_ref,
  });
  return {
    ...binding(authorization),
    view: { kind: "actionable" },
    item_limit: 1,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 2,
    source_has_more: true,
    rows: [
      {
        item,
        priority_rank_proof_text: "3",
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor: {
          order: ["2026-08-25", TASK_ID],
          tie_breaker: TASK_ID,
        },
      },
    ],
    collection_proof_ref: taskListCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: true,
      children: [
        {
          task_ref: item.task_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
  };
}

function budgetPressureListRaw(authorization: ListAuthorization) {
  const sourceInspected = 25;
  const context = taskListProofContext({
    authorization,
    cursor: null,
    readAt: TASK_READ_AT,
    sourceRevisions: TASK_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore: false,
  });
  const assignees = Array.from({ length: 25 }, (_, index) => ({
    team_member_ref: {
      kind: "team_member" as const,
      id: `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
    },
    display_name: `${String(index + 1).padStart(2, "0")}-${"A".repeat(230)}`,
    content_kind: "untrusted_business_data" as const,
  }));
  const rows = Array.from({ length: 25 }, (_, index) => {
    const taskId = `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
    const item = {
      ...taskSummary(),
      task_ref: { kind: "task" as const, id: taskId },
      title: `${String(index + 1).padStart(2, "0")}-${"T".repeat(230)}`,
      assignees,
    };
    const proofRef = taskListEntityProofRef({
      context,
      task: item,
      priorityRankText: "3",
    });
    const evidenceRef = taskListEvidenceRef({
      context,
      taskRef: item.task_ref,
    });
    return {
      item,
      priority_rank_proof_text: "3",
      proof_ref: proofRef,
      evidence_ref: evidenceRef,
      predecessor: {
        order: ["2026-08-25", taskId],
        tie_breaker: taskId,
      },
    } as const;
  });
  return {
    context,
    raw: {
      ...binding(authorization),
      view: { kind: "actionable" },
      item_limit: 25,
      cursor_read_at: null,
      cursor_source_revisions: [],
      cursor_predecessor: null,
      source_inspected: sourceInspected,
      source_has_more: false,
      rows,
      collection_proof_ref: taskListCollectionProofRef({
        context,
        returnedCount: rows.length,
        hasMore: false,
        children: rows.map((row) => ({
          task_ref: row.item.task_ref,
          proof_ref: row.proof_ref,
          evidence_ref: row.evidence_ref,
        })),
      }),
    },
  } as const;
}

function detailRaw(authorization: DetailAuthorization) {
  const result: Omit<GetTaskContextResult, "evidence" | "proof"> = {
    task: taskSummary(),
    blocker_codes: [],
    sections: {
      dependencies: {
        state: "no_dependencies",
        source_count: 0,
        dependencies: [],
      },
      evidence_state: { state: "not_recorded" },
      material_readiness: {
        state: "not_required",
        required_line_count: 0,
        shortage_line_count: 0,
        invalid_line_count: 0,
      },
    },
  };
  const sourceInspected = {
    assignees: 1,
    dependencies: 0,
    task_evidence: 0,
    materials: 0,
  } as const;
  const context = taskContextProofContext({
    authorization,
    readAt: TASK_READ_AT,
    sourceRevisions: TASK_SOURCE_REVISIONS,
    sourceInspected,
  });
  return {
    ...binding(authorization),
    task_ref: { kind: "task", id: TASK_ID },
    selected_sections: ["dependencies", "evidence_state", "material_readiness"],
    source_inspected: sourceInspected,
    result,
    priority_rank_proof_text: "3",
    proof_ref: taskContextEntityProofRef({
      context,
      result,
      priorityRankText: "3",
    }),
    evidence_ref: taskContextEvidenceRef({ context }),
  };
}

describe("P2 list_tasks service", () => {
  it("returns frozen, proof-coupled, serializer-bounded tasks and signs only the retained predecessor", async () => {
    const authorization = await listTasksAuthorization({ limit: 1 });
    const raw = listRaw(authorization);
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseTaskReadRepository(client);
    const cursors = createTaskListCursorService({
      keyId: "task-service",
      key: Buffer.alloc(32, 7),
    });
    const result = await listTasks({ authorization, repository, cursors });

    expect(result).toMatchObject({
      items: [{ task_ref: { id: TASK_ID } }],
      item_proofs: [{ proof_ref: raw.rows[0]!.proof_ref }],
      evidence: [{ evidence_ref: raw.rows[0]!.evidence_ref }],
      collection_proof: {
        proof_ref: raw.collection_proof_ref,
        returned_count: 1,
        has_more: true,
      },
    });
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a forged cursor before repository access and maps stale/source bounds to fixed errors", async () => {
    const authorization = await listTasksAuthorization({
      cursor: "forged.cursor.value",
    });
    const client = new StubRpcClient([]);
    const repository = createSupabaseTaskReadRepository(client);
    const cursors = createTaskListCursorService({
      keyId: "task-service",
      key: Buffer.alloc(32, 8),
    });
    await expect(
      listTasks({ authorization, repository, cursors })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(client.calls).toHaveLength(0);

    for (const [error, code] of [
      [{ code: "40001", message: "agent_task_read_stale" }, "STALE_CONTEXT"],
      [
        { code: "54000", message: "agent_task_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
    ] as const) {
      const exactAuthorization = await listTasksAuthorization();
      const exactRepository = createSupabaseTaskReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        listTasks({
          authorization: exactAuthorization,
          repository: exactRepository,
          cursors,
        })
      ).rejects.toMatchObject({ code });
    }
  });

  it("atomically reduces oversized rows and re-proves the exact retained children", async () => {
    const authorization = await listTasksAuthorization({ limit: 25 });
    const pressure = budgetPressureListRaw(authorization);
    const repository = createSupabaseTaskReadRepository(
      new StubRpcClient([{ data: pressure.raw, error: null }])
    );
    const cursors = createTaskListCursorService({
      keyId: "task-budget-reproof",
      key: Buffer.alloc(32, 9),
    });

    const result = await listTasks({ authorization, repository, cursors });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(pressure.raw.rows.length);
    expect(result.collection_proof.returned_count).toBe(result.items.length);
    expect(result.collection_proof.has_more).toBe(true);
    expect(result.collection_proof.proof_ref).not.toBe(
      pressure.raw.collection_proof_ref
    );
    expect(result.collection_proof.proof_ref).toBe(
      taskListCollectionProofRef({
        context: pressure.context,
        returnedCount: result.items.length,
        hasMore: true,
        children: pressure.raw.rows
          .slice(0, result.items.length)
          .map((row) => ({
            task_ref: row.item.task_ref,
            proof_ref: row.proof_ref,
            evidence_ref: row.evidence_ref,
          })),
      })
    );
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
  });
});

describe("P2 get_task_context service", () => {
  it("returns one exact frozen task context within the exact serializer budget", async () => {
    const authorization = await taskContextAuthorization();
    const raw = detailRaw(authorization);
    const repository = createSupabaseTaskReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const result = await getTaskContext({ authorization, repository });

    expect(result.task.task_ref.id).toBe(TASK_ID);
    expect(result.sections).not.toHaveProperty("notes");
    expect(result.sections).not.toHaveProperty("financial_origin");
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps hidden/nonexistent indistinguishable and never leaks raw repository errors", async () => {
    const authorization = await taskContextAuthorization();
    for (const [error, code] of [
      [
        { code: "P0002", message: "agent_task_not_found_or_not_visible" },
        "NOT_FOUND",
      ],
      [
        { code: "XX000", message: "secret table task_materials" },
        "TEMPORARILY_UNAVAILABLE",
      ],
    ] as const) {
      const repository = createSupabaseTaskReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      let caught: unknown;
      try {
        await getTaskContext({ authorization, repository });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TaskReadError);
      expect(caught).toMatchObject({ code });
      expect(JSON.stringify(caught)).not.toContain("task_materials");
    }
  });
});
