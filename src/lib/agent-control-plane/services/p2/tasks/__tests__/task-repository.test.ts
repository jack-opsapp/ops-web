import { describe, expect, it } from "vitest";

import type { GetTaskContextResult } from "@/lib/agent-control-plane/contracts/tasks";

import {
  createSupabaseTaskReadRepository,
  TaskReadRepositoryError,
} from "../task-repository";
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
    args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected task RPC");
    const request = Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
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

function listRaw(
  authorization: ListAuthorization,
  overrides: Record<string, unknown> = {}
) {
  const item = taskSummary();
  const context = taskListProofContext({
    authorization,
    cursor: null,
    readAt: TASK_READ_AT,
    sourceRevisions: TASK_SOURCE_REVISIONS,
    sourceInspected: 1,
    sourceHasMore: false,
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
  const row = {
    item,
    priority_rank_proof_text: "3",
    proof_ref: proofRef,
    evidence_ref: evidenceRef,
    predecessor: {
      order: ["2026-08-25", TASK_ID],
      tie_breaker: TASK_ID,
    },
  } as const;
  return {
    ...binding(authorization),
    view: { kind: "actionable" },
    item_limit: 25,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 1,
    source_has_more: false,
    rows: [row],
    collection_proof_ref: taskListCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          task_ref: item.task_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
    ...overrides,
  };
}

function detailRaw(
  authorization: DetailAuthorization,
  overrides: Record<string, unknown> = {}
) {
  const result: Omit<GetTaskContextResult, "evidence" | "proof"> = {
    task: taskSummary(),
    blocker_codes: [],
    sections: {
      dependencies: {
        state: "no_dependencies",
        source_count: 0,
        dependencies: [],
      },
      evidence_state: { state: "recorded", evidence_count: 2 },
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
    task_evidence: 2,
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
    ...overrides,
  };
}

describe("P2 task list repository", () => {
  it("calls only the literal fixed list RPC with current actor/company/grant/policy, closed filter, and physical bounds", async () => {
    const authorization = await listTasksAuthorization();
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseTaskReadRepository(client);
    const result = await repository.list({ authorization, cursor: null });

    expect(result).toMatchObject({
      state: "found",
      page: {
        readAt: TASK_READ_AT,
        sourceRevisions: TASK_SOURCE_REVISIONS,
        sourceHasMore: false,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_tasks_as_system",
      args: expect.objectContaining({
        p_actor_user_id: TASK_ACTOR_ID,
        p_company_id: TASK_COMPANY_ID,
        p_oauth_grant_id: TASK_GRANT_ID,
        p_oauth_client_id: TASK_CLIENT_ID,
        p_grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        p_permission_snapshot_revision: TASK_PERMISSION_REVISION,
        p_capability_id: "list_tasks",
        p_tasks_scope: "all",
        p_projects_scope: "assigned",
        p_view_kind: "actionable",
        p_item_limit: 25,
        p_page_fetch_limit: 26,
        p_source_limit: 501,
        p_cursor_read_at: null,
        p_after_task_id: null,
      }),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects binding, ordering, proof collisions, malformed evidence, privacy, 501-bound, and cursor echo tampering", async () => {
    const authorization = await listTasksAuthorization();
    const exact = listRaw(authorization);
    const itemProofRef = exact.rows[0]!.proof_ref;
    const collectionProofRef = exact.collection_proof_ref;
    const proofContext = taskListProofContext({
      authorization,
      cursor: null,
      readAt: TASK_READ_AT,
      sourceRevisions: TASK_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const invalidRows = [
      listRaw(authorization, {
        actor_user_id: "99999999-9999-4999-8999-999999999999",
      }),
      listRaw(authorization, { source_inspected: 501 }),
      listRaw(authorization, { collection_proof_ref: itemProofRef }),
      listRaw(authorization, {
        rows: [{ ...exact.rows[0], proof_ref: collectionProofRef }],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            evidence_ref: `ops_evidence:v1:${"F".repeat(64)}`,
          },
        ],
      }),
      listRaw(authorization, {
        rows: [exact.rows[0], { ...exact.rows[0], proof_ref: itemProofRef }],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            item: { ...taskSummary(), private_employee_email: "x@example.com" },
          },
        ],
      }),
      listRaw(authorization, {
        source_revisions: [{ domain: "tasks", source_revision: 13 }],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            proof_ref: taskListEntityProofRef({
              context: {
                ...proofContext,
                oauth_client_id: "99999999-9999-4999-8999-999999999999",
              },
              task: exact.rows[0]!.item,
              priorityRankText: "3",
            }),
          },
        ],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            evidence_ref: taskListEvidenceRef({
              context: { ...proofContext, view: { kind: "all" } },
              taskRef: exact.rows[0]!.item.task_ref,
            }),
          },
        ],
      }),
    ];

    for (const raw of invalidRows) {
      const repository = createSupabaseTaskReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(TaskReadRepositoryError);
    }
  });

  it("maps only exact source-bound and stale errors to privacy-safe states", async () => {
    const authorization = await listTasksAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_task_source_query_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_task_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseTaskReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({
        state,
      });
    }
  });

  it("rejects a non-task cursor revision vector before making an RPC", async () => {
    const authorization = await listTasksAuthorization();
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseTaskReadRepository(client);

    await expect(
      repository.list({
        authorization,
        cursor: {
          readAt: TASK_READ_AT,
          sourceRevisions: [{ domain: "tasks", source_revision: 13 }],
          predecessor: {
            order: ["2026-08-25", TASK_ID],
            tie_breaker: TASK_ID,
          },
        },
      })
    ).rejects.toThrow(TaskReadRepositoryError);
    expect(client.calls).toHaveLength(0);
  });
});

describe("P2 task context repository", () => {
  it("calls only the literal fixed detail RPC and returns strict frozen sections with exact source identities", async () => {
    const authorization = await taskContextAuthorization();
    const raw = detailRaw(authorization);
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseTaskReadRepository(client);
    const result = await repository.get({ authorization });

    expect(client.calls[0]).toEqual({
      functionName: "read_agent_task_context_as_system",
      args: expect.objectContaining({
        p_task_id: TASK_ID,
        p_sections: ["dependencies", "evidence_state", "material_readiness"],
        p_source_limit: 501,
        p_dependency_limit: 25,
        p_assignee_limit: 25,
      }),
    });
    expect(result).toMatchObject({
      state: "found",
      value: {
        task: { task_ref: { id: TASK_ID } },
        evidence: [{ evidence_ref: raw.evidence_ref }],
        proof: { proof_ref: raw.proof_ref },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps hidden/nonexistent indistinguishable and rejects unselected finance, notes, or malformed source counts", async () => {
    const authorization = await taskContextAuthorization();
    const exact = detailRaw(authorization);
    const proofContext = taskContextProofContext({
      authorization,
      readAt: TASK_READ_AT,
      sourceRevisions: TASK_SOURCE_REVISIONS,
      sourceInspected: exact.source_inspected,
    });
    const invalid = [
      detailRaw(authorization, {
        result: {
          ...exact.result,
          sections: {
            ...exact.result.sections,
            financial_origin: { state: "manual" },
          },
        },
      }),
      detailRaw(authorization, { selected_sections: ["notes"] }),
      detailRaw(authorization, {
        source_inspected: {
          assignees: 1,
          dependencies: 501,
          task_evidence: 2,
          materials: 0,
        },
      }),
      detailRaw(authorization, {
        proof_ref: `ops_proof:v1:${"E".repeat(64)}`,
      }),
      detailRaw(authorization, {
        evidence_ref: `ops_evidence:v1:${"F".repeat(64)}`,
      }),
      detailRaw(authorization, {
        result: {
          ...exact.result,
          task: {
            ...taskSummary(),
            private_employee_email: "x@example.com",
          },
        },
      }),
      detailRaw(authorization, {
        proof_ref: taskContextEntityProofRef({
          context: { ...proofContext, selected_sections: ["notes"] },
          result: exact.result,
          priorityRankText: "3",
        }),
      }),
      detailRaw(authorization, {
        evidence_ref: taskContextEvidenceRef({
          context: {
            ...proofContext,
            source_inspected: {
              ...proofContext.source_inspected,
              materials: 1,
            },
          },
        }),
      }),
      detailRaw(authorization, {
        source_inspected: {
          ...exact.source_inspected,
          task_evidence: 1,
        },
      }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseTaskReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        TaskReadRepositoryError
      );
    }

    const hidden = createSupabaseTaskReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_task_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(hidden.get({ authorization })).resolves.toEqual({
      state: "not_found",
    });
  });

  it("honors cancellation without returning late data", async () => {
    const authorization = await taskContextAuthorization();
    const controller = new AbortController();
    controller.abort();
    const repository = createSupabaseTaskReadRepository(
      new StubRpcClient([{ data: detailRaw(authorization), error: null }])
    );
    await expect(
      repository.get({ authorization, signal: controller.signal })
    ).rejects.toThrow(TaskReadRepositoryError);
  });
});
