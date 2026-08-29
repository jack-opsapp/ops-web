import { describe, expect, it } from "vitest";

import { ListPaymentsResultSchema } from "@/lib/agent-control-plane/contracts/sales-documents";
import { createPaymentCursorService } from "../payment-cursor";
import { listPayments, PaymentReadError } from "../payment-reads";
import { createSupabasePaymentReadRepository } from "../payment-repository";
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
  PAYMENT_PERMISSION_REVISION,
  PAYMENT_READ_AT,
  PAYMENT_SOURCE_REVISIONS,
  listPaymentAuthorization,
  paymentItem,
} from "./payment-fixtures";

class StubRpcClient {
  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}
  rpc() {
    return Promise.resolve(this.response);
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

function rawList(authorization: Authorization, sourceHasMore = false) {
  const item = paymentItem();
  const context = paymentListProofContext({
    authorization,
    cursor: null,
    readAt: PAYMENT_READ_AT,
    sourceRevisions: PAYMENT_SOURCE_REVISIONS,
    sourceInspected: 1,
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
      invoice_ref: null,
      customer_ref: null,
      job_ref: null,
      payment_date_window: null,
      method_categories: authorization.query.method_categories,
      reconciliation_states: authorization.query.reconciliation_states,
    },
    ranking_revision: "payment-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    read_at: PAYMENT_READ_AT,
    source_revisions: PAYMENT_SOURCE_REVISIONS,
    source_inspected: 1,
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
  };
}

const cursors = createPaymentCursorService({
  keyId: "payment-service-test",
  key: new Uint8Array(32).fill(16),
});

describe("P2 payment read service", () => {
  it("returns a strict proof-coupled ledger and opaque continuation cursor", async () => {
    const authorization = await listPaymentAuthorization({ limit: 1 });
    const repository = createSupabasePaymentReadRepository(
      new StubRpcClient({ data: rawList(authorization, true), error: null })
    );
    const result = await listPayments({ authorization, repository, cursors });
    expect(ListPaymentsResultSchema.parse(result)).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toMatch(
      /^ops_p2_cursor\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("maps exact bound, invalid, stale, and cursor states", async () => {
    const invalidCursor = await listPaymentAuthorization({
      cursor: "not-a-valid-cursor",
      limit: 1,
    });
    const unused = createSupabasePaymentReadRepository(
      new StubRpcClient({ data: null, error: null })
    );
    await expect(
      listPayments({
        authorization: invalidCursor,
        repository: unused,
        cursors,
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const authorization = await listPaymentAuthorization();
    for (const [error, code] of [
      [
        { code: "54000", message: "agent_payment_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "22000", message: "agent_payment_source_data_invalid" },
        "SOURCE_DATA_INVALID",
      ],
      [{ code: "40001", message: "agent_payment_read_stale" }, "STALE_CONTEXT"],
    ] as const) {
      const repository = createSupabasePaymentReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        listPayments({ authorization, repository, cursors })
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects reconstructed authority and untrusted repositories", async () => {
    const authorization = await listPaymentAuthorization();
    const repository = createSupabasePaymentReadRepository(
      new StubRpcClient({ data: rawList(authorization), error: null })
    );
    await expect(
      listPayments({
        authorization: { ...authorization } as never,
        repository,
        cursors,
      })
    ).rejects.toBeInstanceOf(PaymentReadError);
    await expect(
      listPayments({
        authorization,
        repository: {
          list: async () => ({ state: "stale" as const }),
        } as never,
        cursors,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
