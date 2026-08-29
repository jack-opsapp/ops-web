import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  ExpenseReadRepositoryError,
  createSupabaseExpenseReadRepository,
} from "../expense-repository";
import {
  expenseCollectionProofRef,
  expenseContextEntityProofRef,
  expenseContextEvidenceRef,
  expenseEntityProofRef,
  expenseListEvidenceRef,
  expenseListProofContext,
} from "../expense-proof";
import {
  EXPENSE_ACTOR_ID,
  EXPENSE_CLIENT_ID,
  EXPENSE_COMPANY_ID,
  EXPENSE_GRANT_ID,
  EXPENSE_ID,
  EXPENSE_PERMISSION_REVISION,
  EXPENSE_READ_AT,
  EXPENSE_SOURCE_REVISIONS,
  expenseSummary,
  getExpenseAuthorization,
  listExpenseAuthorization,
} from "./expense-fixtures";

interface StubResponse {
  readonly data: unknown;
  readonly error: unknown;
}

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  private readonly responses: StubResponse[];

  constructor(responses: readonly StubResponse[]) {
    this.responses = [...responses];
  }

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const response = this.responses.shift() ?? {
      data: null,
      error: { code: "XX000", message: "unexpected" },
    };
    const request = Promise.resolve(response) as Promise<StubResponse> & {
      abortSignal?: (signal: AbortSignal) => Promise<StubResponse>;
    };
    request.abortSignal = (signal) =>
      signal.aborted
        ? Promise.reject(new DOMException("Aborted", "AbortError"))
        : request;
    return request;
  }
}

type ListAuthorization = Awaited<ReturnType<typeof listExpenseAuthorization>>;
type DetailAuthorization = Awaited<ReturnType<typeof getExpenseAuthorization>>;

function candidate(authorization: ListAuthorization | DetailAuthorization) {
  const selected = authorization.authorizationCandidate;
  return {
    variant_key: selected.variantKey,
    required_oauth_scopes: selected.requiredOAuthScopes,
    resolved_permission_scopes: selected.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      selected.satisfiedPermissionGroupIndexes,
  };
}

function queryProjection(authorization: ListAuthorization) {
  return { view: authorization.query.view };
}

function binding(authorization: ListAuthorization | DetailAuthorization) {
  return {
    company_id: EXPENSE_COMPANY_ID,
    actor_user_id: EXPENSE_ACTOR_ID,
    oauth_grant_id: EXPENSE_GRANT_ID,
    oauth_client_id: EXPENSE_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: EXPENSE_PERMISSION_REVISION,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    authorization_candidate: candidate(authorization),
    read_at: EXPENSE_READ_AT,
    source_revisions: EXPENSE_SOURCE_REVISIONS,
  } as const;
}

function listRaw(
  authorization: ListAuthorization,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const item = expenseSummary();
  const sourceInspected = 1;
  const sourceHasMore = false;
  const context = expenseListProofContext({
    authorization,
    cursor: null,
    readAt: EXPENSE_READ_AT,
    sourceRevisions: EXPENSE_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const proofRef = expenseEntityProofRef({ context, item });
  const evidenceRef = expenseListEvidenceRef({ context, item });
  const row = {
    item,
    proof_ref: proofRef,
    evidence_ref: evidenceRef,
    predecessor: {
      item_kind: "expense",
      order: [item.expense_date!, item.expense_ref.id],
      tie_breaker: item.expense_ref.id,
    },
  } as const;
  return {
    ...binding(authorization),
    query: queryProjection(authorization),
    ranking_revision: "expense-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows: [row],
    collection_proof_ref: expenseCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: sourceHasMore,
      children: [
        {
          item_ref: item.expense_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
    ...overrides,
  };
}

function detailSource() {
  return {
    expense: expenseSummary(),
    batch: null,
    payout_state: "not_eligible" as const,
    review_reason: {
      kind: "flag" as const,
      text: "Receipt needs a clearer total.",
      content_kind: "untrusted_business_data" as const,
    },
  };
}

function detailRaw(
  authorization: DetailAuthorization,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const result = detailSource();
  const sourceInspected = { allocations: 1, batches: 0 };
  return {
    ...binding(authorization),
    source_inspected: sourceInspected,
    result,
    proof_ref: expenseContextEntityProofRef({
      authorization,
      readAt: EXPENSE_READ_AT,
      sourceRevisions: EXPENSE_SOURCE_REVISIONS,
      sourceInspected,
      result,
    }),
    evidence_ref: expenseContextEvidenceRef({
      companyId: EXPENSE_COMPANY_ID,
      expenseId: EXPENSE_ID,
      occurredAt: expenseSummary().updated_at,
    }),
    ...overrides,
  };
}

describe("P2 expense repository", () => {
  it("calls the fixed list RPC with exact selected authority and 25/26/501 bounds", async () => {
    const authorization = await listExpenseAuthorization({
      view: { kind: "mine" },
      limit: 25,
    });
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseExpenseReadRepository(client);
    await expect(
      repository.list({ authorization, cursor: null })
    ).resolves.toMatchObject({
      state: "found",
    });
    expect(client.calls).toEqual([
      {
        functionName: "read_agent_expenses_as_system",
        args: expect.objectContaining({
          p_request_id: "request-expense-read",
          p_company_id: EXPENSE_COMPANY_ID,
          p_actor_user_id: EXPENSE_ACTOR_ID,
          p_oauth_grant_id: EXPENSE_GRANT_ID,
          p_oauth_client_id: EXPENSE_CLIENT_ID,
          p_grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_authorization_candidate: candidate(authorization),
          p_view_kind: "mine",
          p_project_id: null,
          p_batch_disposition: null,
          p_item_limit: 25,
          p_page_fetch_limit: 26,
          p_source_limit: 501,
          p_cursor_read_at: null,
          p_cursor_source_revisions: [],
          p_after_order_date: null,
          p_after_id: null,
        }),
      },
    ]);
  });

  it("rejects binding, query, revision, source, item, order, proof, and count tampering", async () => {
    const authorization = await listExpenseAuthorization();
    const base = listRaw(authorization);
    const invalid = [
      listRaw(authorization, {
        actor_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      listRaw(authorization, { query: { view: { kind: "company" } } }),
      listRaw(authorization, { source_inspected: 501 }),
      listRaw(authorization, {
        source_revisions: [{ domain: "payments", source_revision: 19 }],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...base.rows[0],
            proof_ref: `ops_proof:v1:${"f".repeat(64)}`,
          },
        ],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...base.rows[0],
            predecessor: {
              ...base.rows[0]!.predecessor,
              order: ["2026-08-19", EXPENSE_ID],
            },
          },
        ],
      }),
      listRaw(authorization, { rows: [base.rows[0], base.rows[0]] }),
      listRaw(authorization, {
        rows: [
          {
            ...base.rows[0],
            item: { ...base.rows[0]!.item, expense_count: 2 },
          },
        ],
      }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseExpenseReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toBeInstanceOf(ExpenseReadRepositoryError);
    }
  });

  it("returns exact detail and rejects forbidden fields, long reasons, and forged proof", async () => {
    const authorization = await getExpenseAuthorization();
    const repository = createSupabaseExpenseReadRepository(
      new StubRpcClient([{ data: detailRaw(authorization), error: null }])
    );
    await expect(repository.get({ authorization })).resolves.toMatchObject({
      state: "found",
      value: {
        expense: { expense_ref: { id: EXPENSE_ID } },
        review_reason: { kind: "flag" },
      },
    });

    for (const raw of [
      detailRaw(authorization, {
        result: { ...detailSource(), payment_method: "cash" },
      }),
      detailRaw(authorization, {
        result: {
          ...detailSource(),
          review_reason: {
            ...detailSource().review_reason,
            text: "x".repeat(1_001),
          },
        },
      }),
      detailRaw(authorization, {
        proof_ref: `ops_proof:v1:${"e".repeat(64)}`,
      }),
    ]) {
      const candidateRepository = createSupabaseExpenseReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        candidateRepository.get({ authorization })
      ).rejects.toBeInstanceOf(ExpenseReadRepositoryError);
    }
  });

  it("maps only exact hidden, 501/result, stale, and invalid-source errors", async () => {
    const listAuthorization = await listExpenseAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_expense_source_query_bound" },
        "source_bound",
      ],
      [
        { code: "54000", message: "agent_expense_result_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_expense_read_stale" }, "stale"],
      [
        { code: "22000", message: "agent_expense_source_data_invalid" },
        "source_invalid",
      ],
    ] as const) {
      const repository = createSupabaseExpenseReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization: listAuthorization, cursor: null })
      ).resolves.toEqual({
        state,
      });
    }
    const detailAuthorization = await getExpenseAuthorization();
    const repository = createSupabaseExpenseReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_expense_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(
      repository.get({ authorization: detailAuthorization })
    ).resolves.toEqual({
      state: "not_found",
    });
  });
});
