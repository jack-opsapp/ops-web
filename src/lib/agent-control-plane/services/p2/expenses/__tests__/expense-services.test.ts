import { describe, expect, it } from "vitest";

import {
  GetExpenseContextResultSchema,
  ListExpensesResultSchema,
} from "@/lib/agent-control-plane/contracts/expenses";
import { AgentErrorSchema } from "@/lib/agent-control-plane/contracts/errors";
import { createExpenseCursorService } from "../expense-cursor";
import {
  ExpenseReadError,
  getExpenseContext,
  listExpenses,
} from "../expense-reads";
import { createSupabaseExpenseReadRepository } from "../expense-repository";
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

class StubRpcClient {
  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}

  rpc() {
    return Promise.resolve(this.response);
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

function rawList(authorization: ListAuthorization, sourceHasMore = false) {
  const item = expenseSummary();
  const context = expenseListProofContext({
    authorization,
    cursor: null,
    readAt: EXPENSE_READ_AT,
    sourceRevisions: EXPENSE_SOURCE_REVISIONS,
    sourceInspected: 2,
    sourceHasMore,
  });
  const proofRef = expenseEntityProofRef({ context, item });
  const evidenceRef = expenseListEvidenceRef({ context, item });
  return {
    ...binding(authorization),
    query: { view: authorization.query.view },
    ranking_revision: "expense-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 2,
    source_has_more: sourceHasMore,
    rows: [
      {
        item,
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor: {
          item_kind: "expense",
          order: [item.expense_date!, item.expense_ref.id],
          tie_breaker: item.expense_ref.id,
        },
      },
    ],
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
  };
}

function rawDetail(authorization: DetailAuthorization) {
  const result = {
    expense: expenseSummary(),
    batch: null,
    payout_state: "not_eligible" as const,
    review_reason: {
      kind: "flag" as const,
      text: "Receipt needs a clearer total.",
      content_kind: "untrusted_business_data" as const,
    },
  };
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
      occurredAt: result.expense.updated_at,
    }),
  };
}

const cursors = createExpenseCursorService({
  keyId: "expense-service-test",
  key: new Uint8Array(32).fill(16),
});

describe("P2 expense read services", () => {
  it.each([
    ["INTERNAL", "INTERNAL"],
    ["INVALID_CURSOR", "INVALID_ARGUMENT"],
    ["NOT_FOUND", "NOT_FOUND"],
    ["RESULT_TOO_LARGE", "RESULT_TOO_LARGE"],
    ["SOURCE_DATA_INVALID", "TEMPORARILY_UNAVAILABLE"],
    ["STALE_CONTEXT", "TEMPORARILY_UNAVAILABLE"],
    ["TEMPORARILY_UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"],
  ] as const)(
    "serializes %s as the contract-safe %s agent error",
    (code, publicCode) => {
      const error = new ExpenseReadError({
        code,
        requestId: "request-expense-read",
      });
      const envelope = AgentErrorSchema.parse(error.toAgentError());

      expect(envelope).toMatchObject({
        contract_version: "2026-08-07.v1",
        request_id: "request-expense-read",
        code: publicCode,
        message: error.message,
        retryable: error.retryable,
      });
      if (code === "INVALID_CURSOR") {
        expect(envelope).toMatchObject({
          details: {
            field_issues: [
              {
                path: ["cursor"],
                code: "INVALID_CURSOR",
                message: "This expense page expired. Start again.",
              },
            ],
          },
        });
      }
    }
  );

  it("returns a strict proof-coupled list and an opaque continuation cursor", async () => {
    const authorization = await listExpenseAuthorization({
      view: { kind: "mine" },
      limit: 1,
    });
    const repository = createSupabaseExpenseReadRepository(
      new StubRpcClient({ data: rawList(authorization, true), error: null })
    );
    const result = await listExpenses({
      authorization,
      repository,
      cursors,
    });
    expect(ListExpensesResultSchema.parse(result)).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toMatch(
      /^ops_p2_cursor\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns strict detail with canonical money and bounded review context", async () => {
    const authorization = await getExpenseAuthorization();
    const repository = createSupabaseExpenseReadRepository(
      new StubRpcClient({ data: rawDetail(authorization), error: null })
    );
    const result = await getExpenseContext({ authorization, repository });
    expect(GetExpenseContextResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      expense: {
        amount: { amount_minor: 12_345, currency: "CAD" },
      },
      review_reason: { kind: "flag" },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("maps exact hidden, bound, invalid, stale, and cursor terminal states", async () => {
    const invalidCursorAuthorization = await listExpenseAuthorization({
      view: { kind: "mine" },
      cursor: "not-a-valid-cursor",
      limit: 1,
    });
    const unusedRepository = createSupabaseExpenseReadRepository(
      new StubRpcClient({ data: null, error: null })
    );
    await expect(
      listExpenses({
        authorization: invalidCursorAuthorization,
        repository: unusedRepository,
        cursors,
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const authorization = await getExpenseAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_expense_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "54000", message: "agent_expense_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "22000", message: "agent_expense_source_data_invalid" },
        "SOURCE_DATA_INVALID",
      ],
      [{ code: "40001", message: "agent_expense_read_stale" }, "STALE_CONTEXT"],
    ] as const) {
      const repository = createSupabaseExpenseReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        getExpenseContext({ authorization, repository })
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects reconstructed authority and untrusted repository objects", async () => {
    const authorization = await getExpenseAuthorization();
    const repository = createSupabaseExpenseReadRepository(
      new StubRpcClient({ data: rawDetail(authorization), error: null })
    );
    await expect(
      getExpenseContext({
        authorization: { ...authorization } as never,
        repository,
      })
    ).rejects.toBeInstanceOf(ExpenseReadError);
    await expect(
      getExpenseContext({
        authorization,
        repository: {
          get: async () => ({ state: "not_found" as const }),
        } as never,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
