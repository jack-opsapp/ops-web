import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  PaymentReadRepositoryError,
  createSupabasePaymentReadRepository,
} from "../payment-repository";
import type { PaymentCursorContext } from "../payment-cursor";
import {
  paymentCollectionProofRef,
  paymentEntityProofRef,
  paymentListEvidenceRef,
  paymentListProofContext,
} from "../payment-proof";
import {
  PAYMENT_ACTOR_ID,
  PAYMENT_CLIENT_ID,
  PAYMENT_COMPANY_ID,
  PAYMENT_GRANT_ID,
  PAYMENT_ID,
  PAYMENT_PERMISSION_REVISION,
  PAYMENT_READ_AT,
  PAYMENT_SOURCE_REVISIONS,
  listPaymentAuthorization,
  paymentItem,
} from "./payment-fixtures";

interface StubResponse {
  readonly data: unknown;
  readonly error: unknown;
}

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  constructor(private readonly responses: StubResponse[]) {}
  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const response = this.responses.shift() ?? {
      data: null,
      error: { code: "XX000", message: "unexpected" },
    };
    return Promise.resolve(response);
  }
}

type Authorization = Awaited<ReturnType<typeof listPaymentAuthorization>>;

function candidate(authorization: Authorization) {
  const selected = authorization.authorizationCandidate;
  return {
    variant_key: selected.variantKey,
    required_oauth_scopes: selected.requiredOAuthScopes,
    resolved_permission_scopes: selected.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      selected.satisfiedPermissionGroupIndexes,
  };
}

export function paymentRaw(
  authorization: Authorization,
  overrides: Readonly<Record<string, unknown>> = {},
  cursor: PaymentCursorContext | null = null,
  itemOverrides: Readonly<Record<string, unknown>> = {}
) {
  const item = paymentItem(itemOverrides);
  const sourceInspected = 1;
  const sourceHasMore = false;
  const context = paymentListProofContext({
    authorization,
    cursor,
    readAt: PAYMENT_READ_AT,
    sourceRevisions: PAYMENT_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const proofRef = paymentEntityProofRef({
    context,
    item,
    authorityPath: "project",
  });
  const evidenceRef = paymentListEvidenceRef({
    context,
    item,
    authorityPath: "project",
  });
  return {
    company_id: PAYMENT_COMPANY_ID,
    actor_user_id: PAYMENT_ACTOR_ID,
    oauth_grant_id: PAYMENT_GRANT_ID,
    oauth_client_id: PAYMENT_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: PAYMENT_PERMISSION_REVISION,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    capability_id: "list_payments",
    capability_revision: "list_payments:2026-08-22.v1",
    authorization_candidate: candidate(authorization),
    query: {
      invoice_ref: authorization.query.invoice_ref ?? null,
      customer_ref: authorization.query.customer_ref ?? null,
      job_ref: authorization.query.job_ref ?? null,
      payment_date_window: authorization.query.payment_date_window ?? null,
      method_categories: authorization.query.method_categories,
      reconciliation_states: authorization.query.reconciliation_states,
    },
    ranking_revision: "payment-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: cursor?.readAt ?? null,
    cursor_source_revisions: cursor?.sourceRevisions ?? [],
    cursor_predecessor: cursor?.predecessor ?? null,
    read_at: PAYMENT_READ_AT,
    source_revisions: PAYMENT_SOURCE_REVISIONS,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows: [
      {
        item,
        authority_path: "project",
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor: {
          order: [item.payment_date, item.payment_ref.id],
          tie_breaker: item.payment_ref.id,
        },
      },
    ],
    collection_proof_ref: paymentCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: sourceHasMore,
      children: [
        {
          payment_ref: item.payment_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
    ...overrides,
  };
}

describe("P2 payment repository", () => {
  it("calls one fixed RPC with exact authority, filters, and 25/26/501 bounds", async () => {
    const authorization = await listPaymentAuthorization({ limit: 25 });
    const client = new StubRpcClient([
      { data: paymentRaw(authorization), error: null },
    ]);
    const repository = createSupabasePaymentReadRepository(client);
    await expect(
      repository.list({ authorization, cursor: null })
    ).resolves.toMatchObject({
      state: "found",
    });
    expect(client.calls).toEqual([
      {
        functionName: "read_agent_payments_as_system",
        args: expect.objectContaining({
          p_request_id: "request-payment-read",
          p_company_id: PAYMENT_COMPANY_ID,
          p_actor_user_id: PAYMENT_ACTOR_ID,
          p_oauth_grant_id: PAYMENT_GRANT_ID,
          p_oauth_client_id: PAYMENT_CLIENT_ID,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_authorization_candidate: candidate(authorization),
          p_invoice_id: null,
          p_client_id: null,
          p_job_kind: null,
          p_job_id: null,
          p_start_date: null,
          p_end_date: null,
          p_method_categories: ["bank", "card", "cash", "check", "other"],
          p_reconciliation_states: ["applied", "voided"],
          p_item_limit: 25,
          p_page_fetch_limit: 26,
          p_source_limit: 501,
          p_cursor_read_at: null,
          p_cursor_source_revisions: [],
          p_after_payment_date: null,
          p_after_id: null,
        }),
      },
    ]);
  });

  it("rejects authority, query, revision, currency, source, order, proof, forbidden, and duplicate tampering", async () => {
    const authorization = await listPaymentAuthorization();
    const base = paymentRaw(authorization);
    const row = base.rows[0]!;
    const invalid = [
      paymentRaw(authorization, {
        actor_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      paymentRaw(authorization, {
        query: { ...base.query, reconciliation_states: ["voided"] },
      }),
      paymentRaw(authorization, {
        source_revisions: PAYMENT_SOURCE_REVISIONS.slice(1),
      }),
      paymentRaw(authorization, { source_inspected: 501 }),
      paymentRaw(authorization, {
        rows: [
          {
            ...row,
            item: {
              ...row.item,
              amount: { amount_minor: 25_000, currency: "USD" },
            },
          },
        ],
      }),
      paymentRaw(authorization, {
        rows: [
          {
            ...row,
            predecessor: {
              order: ["2026-08-21", PAYMENT_ID],
              tie_breaker: PAYMENT_ID,
            },
          },
        ],
      }),
      paymentRaw(authorization, {
        rows: [{ ...row, proof_ref: `ops_proof:v1:${"f".repeat(64)}` }],
      }),
      paymentRaw(authorization, {
        rows: [{ ...row, item: { ...row.item, qb_id: "forbidden" } }],
      }),
      paymentRaw(authorization, { rows: [row, row] }),
    ];
    for (const raw of invalid) {
      const repository = createSupabasePaymentReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toBeInstanceOf(PaymentReadRepositoryError);
    }
  });

  it("maps only exact 501/result, invalid-source, and stale errors", async () => {
    const authorization = await listPaymentAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_payment_source_query_bound" },
        "source_bound",
      ],
      [
        { code: "54000", message: "agent_payment_result_bound" },
        "source_bound",
      ],
      [
        { code: "22000", message: "agent_payment_source_data_invalid" },
        "source_invalid",
      ],
      [{ code: "40001", message: "agent_payment_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabasePaymentReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({ state });
    }
  });

  it("rejects a proof-valid row that does not advance past the cursor", async () => {
    const authorization = await listPaymentAuthorization();
    const cursor: PaymentCursorContext = {
      readAt: PAYMENT_READ_AT,
      sourceRevisions: PAYMENT_SOURCE_REVISIONS,
      predecessor: {
        order: ["2026-08-22", PAYMENT_ID],
        tie_breaker: PAYMENT_ID,
      },
    };
    const repository = createSupabasePaymentReadRepository(
      new StubRpcClient([
        { data: paymentRaw(authorization, {}, cursor), error: null },
      ])
    );
    await expect(
      repository.list({ authorization, cursor })
    ).rejects.toBeInstanceOf(PaymentReadRepositoryError);
  });

  it("rejects a proof-valid void event after the fixed read snapshot", async () => {
    const authorization = await listPaymentAuthorization();
    const raw = paymentRaw(authorization, {}, null, {
      reconciliation_state: "voided",
      voided_at: "2026-08-28T12:00:00.001Z",
    });
    const repository = createSupabasePaymentReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    await expect(
      repository.list({ authorization, cursor: null })
    ).rejects.toBeInstanceOf(PaymentReadRepositoryError);
  });
});
