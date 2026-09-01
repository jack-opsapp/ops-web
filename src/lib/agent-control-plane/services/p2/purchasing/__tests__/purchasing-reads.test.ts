import { describe, expect, it } from "vitest";

import {
  PurchaseOrderDetailResultSchema,
  PurchaseOrderListResultSchema,
  PurchaseOrderWithCostsSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import { createPurchaseOrderCursorService } from "../purchase-order-cursor";
import {
  PurchaseOrderReadError,
  getPurchaseOrder,
  listPurchaseOrders,
} from "../purchase-order-reads";
import { createSupabasePurchaseOrderReadRepository } from "../purchase-order-repository";
import {
  purchaseOrderCollectionProofRef,
  purchaseOrderDetailProofContext,
  purchaseOrderEntityProofRef,
  purchaseOrderEvidenceRef,
  purchaseOrderListProofContext,
  type PurchaseOrderSource,
} from "../purchase-order-proof";
import {
  PURCHASE_ORDER_ID,
  PURCHASING_BASE_REVISIONS,
  PURCHASING_COST_REVISIONS,
  PURCHASING_READ_AT,
  getPurchaseOrderAuthorization,
  listPurchaseOrdersAuthorization,
  purchaseOrder,
} from "./purchasing-fixtures";

class StubRpcClient {
  readonly calls: Array<{
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}

  rpc(name: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ name, args });
    return Promise.resolve(this.response);
  }
}

type Authorization =
  | Awaited<ReturnType<typeof listPurchaseOrdersAuthorization>>
  | Awaited<ReturnType<typeof getPurchaseOrderAuthorization>>;

function candidates(authorization: Authorization) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function projectedQuery(authorization: Authorization) {
  if (authorization.capabilityId === "get_purchase_order") {
    return authorization.query;
  }
  const { cursor: _cursor, ...query } = authorization.query;
  return query;
}

function sourceRevisions(authorization: Authorization) {
  return authorization.query.sections.includes("costs")
    ? PURCHASING_COST_REVISIONS
    : PURCHASING_BASE_REVISIONS;
}

function costWitness(authorization: Authorization) {
  return authorization.query.sections.includes("costs")
    ? `sha256:${"c".repeat(64)}`
    : null;
}

function binding(authorization: Authorization) {
  return {
    company_id: authorization.actorContext.companyId,
    actor_user_id: authorization.actorContext.actorUserId,
    oauth_grant_id: authorization.oauthGrantId,
    oauth_client_id: authorization.oauthClientId,
    grant_revision: authorization.grantRevision,
    granted_scope_ceiling: authorization.grantedScopeCeiling,
    permission_snapshot_revision:
      authorization.actorContext.permissionSnapshotRevision,
    capability_manifest_revision: authorization.capabilityManifestRevision,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    authorization_candidates: candidates(authorization),
    selected_authorization_variants: authorization.variantKeys,
    query: projectedQuery(authorization),
    read_at: PURCHASING_READ_AT,
    source_revisions: sourceRevisions(authorization),
    catalog_cost_witness: costWitness(authorization),
    company_currency: "CAD",
  };
}

function rawList(
  authorization: Awaited<ReturnType<typeof listPurchaseOrdersAuthorization>>,
  sourceHasMore = false,
  sourceInspectedOverride?: Readonly<{
    orders: number;
    lines: number;
    catalog_costs: number;
  }>
) {
  const order = purchaseOrder(authorization.query.sections.includes("costs"));
  const sourceInspected = sourceInspectedOverride ?? {
    orders: sourceHasMore ? 2 : 1,
    lines: 1,
    catalog_costs: authorization.query.sections.includes("costs") ? 1 : 0,
  };
  const context = purchaseOrderListProofContext({
    authorization,
    cursor: null,
    readAt: PURCHASING_READ_AT,
    sourceRevisions: sourceRevisions(authorization),
    sourceInspected,
    sourceHasMore,
    catalogCostWitness: costWitness(authorization),
  });
  const proofRef = purchaseOrderEntityProofRef({ context, order });
  const evidenceRef = purchaseOrderEvidenceRef({ context, order });
  const predecessor = {
    order: [
      order.expected_delivery_date ?? "9999-12-31",
      order.updated_at,
      order.purchase_order_ref.id,
    ],
    tie_breaker: order.purchase_order_ref.id,
  } as const;
  return {
    ...binding(authorization),
    ranking_revision: "purchase-order-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows: [
      {
        purchase_order: order,
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor,
      },
    ],
    collection_proof_ref: purchaseOrderCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: sourceHasMore,
      children: [
        {
          purchase_order_ref: order.purchase_order_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
  };
}

function rawDetail(
  authorization: Awaited<ReturnType<typeof getPurchaseOrderAuthorization>>,
  order: PurchaseOrderSource = purchaseOrder(
    authorization.query.sections.includes("costs")
  ),
  sourceInspectedOverride?: Readonly<{
    orders: number;
    lines: number;
    catalog_costs: number;
  }>
) {
  const sourceInspected = sourceInspectedOverride ?? {
    orders: 1,
    lines: order.line_count,
    catalog_costs: authorization.query.sections.includes("costs") ? 1 : 0,
  };
  const context = purchaseOrderDetailProofContext({
    authorization,
    readAt: PURCHASING_READ_AT,
    sourceRevisions: sourceRevisions(authorization),
    sourceInspected,
    catalogCostWitness: costWitness(authorization),
  });
  return {
    ...binding(authorization),
    source_inspected: sourceInspected,
    purchase_order: order,
    proof_ref: purchaseOrderEntityProofRef({ context, order }),
    evidence_ref: purchaseOrderEvidenceRef({ context, order }),
  };
}

const cursors = createPurchaseOrderCursorService({
  keyId: "purchasing-test",
  key: new Uint8Array(32).fill(17),
});

describe("P2 purchase-order repository and services", () => {
  it("returns proof-coupled filtered rows through only the fixed bounded RPC", async () => {
    const authorization = await listPurchaseOrdersAuthorization({
      statuses: ["sent"],
      supplier: { kind: "exact_label", value: "CanPro" },
      delivery_window: {
        starts_on: "2026-09-01",
        ends_on: "2026-09-30",
      },
      limit: 1,
    });
    const client = new StubRpcClient({
      data: rawList(authorization, true),
      error: null,
    });
    const result = await listPurchaseOrders({
      authorization,
      repository: createSupabasePurchaseOrderReadRepository(client),
      cursors,
    });
    expect(PurchaseOrderListResultSchema.parse(result)).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      name: "read_agent_purchase_orders_as_system",
      args: {
        p_statuses: ["sent"],
        p_supplier_label: "CanPro",
        p_delivery_starts_on: "2026-09-01",
        p_delivery_ends_on: "2026-09-30",
        p_include_costs: false,
        p_item_limit: 1,
        p_page_fetch_limit: 2,
        p_source_limit: 501,
        p_line_fetch_limit: 51,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns no cost field by default and exact costs only after both bindings", async () => {
    const baseAuthorization = await getPurchaseOrderAuthorization();
    const baseClient = new StubRpcClient({
      data: rawDetail(baseAuthorization),
      error: null,
    });
    const base = await getPurchaseOrder({
      authorization: baseAuthorization,
      repository: createSupabasePurchaseOrderReadRepository(baseClient),
    });
    expect(PurchaseOrderDetailResultSchema.parse(base)).toEqual(base);
    expect(base.purchase_order).not.toHaveProperty("costs");
    expect(base.purchase_order.lines[0]).not.toHaveProperty("unit_cost");
    expect(baseClient.calls[0]).toMatchObject({
      name: "read_agent_purchase_order_as_system",
      args: {
        p_purchase_order_id: PURCHASE_ORDER_ID,
        p_include_costs: false,
        p_source_limit: 501,
        p_line_fetch_limit: 51,
      },
    });

    const costAuthorization = await getPurchaseOrderAuthorization({
      includeCosts: true,
    });
    const cost = await getPurchaseOrder({
      authorization: costAuthorization,
      repository: createSupabasePurchaseOrderReadRepository(
        new StubRpcClient({
          data: rawDetail(costAuthorization),
          error: null,
        })
      ),
    });
    expect(cost.purchase_order).toMatchObject({
      lines: [
        {
          unit_cost: { amount_minor: 13_888, currency: "CAD" },
          line_total: { amount_minor: 340_256, currency: "CAD" },
        },
      ],
      costs: {
        subtotal: { amount_minor: 340_256, currency: "CAD" },
        priced_line_count: 1,
        unpriced_line_count: 0,
      },
    });
  });

  it("rejects tampered proof, hidden contact data, and a missing current-cost witness", async () => {
    const authorization = await getPurchaseOrderAuthorization({
      includeCosts: true,
    });
    for (const mutate of [
      (raw: ReturnType<typeof rawDetail>) => ({
        ...raw,
        proof_ref: `ops_proof:v1:${"d".repeat(64)}`,
      }),
      (raw: ReturnType<typeof rawDetail>) => ({
        ...raw,
        catalog_cost_witness: null,
      }),
      (raw: ReturnType<typeof rawDetail>) => ({
        ...raw,
        purchase_order: {
          ...raw.purchase_order,
          supplier_contact: "secret@example.com",
        },
      }),
    ]) {
      const repository = createSupabasePurchaseOrderReadRepository(
        new StubRpcClient({
          data: mutate(rawDetail(authorization)),
          error: null,
        })
      );
      await expect(
        getPurchaseOrder({ authorization, repository })
      ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
    }
  });

  it("rejects a wire snapshot that reaches the physical 501-row fence", async () => {
    const listAuthorization = await listPurchaseOrdersAuthorization();
    const listRepository = createSupabasePurchaseOrderReadRepository(
      new StubRpcClient({
        data: rawList(listAuthorization, false, {
          orders: 501,
          lines: 1,
          catalog_costs: 0,
        }),
        error: null,
      })
    );
    await expect(
      listPurchaseOrders({
        authorization: listAuthorization,
        repository: listRepository,
        cursors,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });

    const detailAuthorization = await getPurchaseOrderAuthorization();
    const detailRepository = createSupabasePurchaseOrderReadRepository(
      new StubRpcClient({
        data: rawDetail(detailAuthorization, purchaseOrder(false), {
          orders: 1,
          lines: 501,
          catalog_costs: 0,
        }),
        error: null,
      })
    );
    await expect(
      getPurchaseOrder({
        authorization: detailAuthorization,
        repository: detailRepository,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });

  it("rejects a zero-line subtotal outside the SQL-bound company currency", async () => {
    const authorization = await getPurchaseOrderAuthorization({
      includeCosts: true,
    });
    const source = purchaseOrder(true);
    const zeroLineOrder = PurchaseOrderWithCostsSchema.parse({
      ...source,
      line_count: 0,
      lines: [],
      costs: {
        subtotal: { amount_minor: 0, currency: "USD" },
        priced_line_count: 0,
        unpriced_line_count: 0,
      },
    });
    const repository = createSupabasePurchaseOrderReadRepository(
      new StubRpcClient({
        data: rawDetail(authorization, zeroLineOrder),
        error: null,
      })
    );
    await expect(
      getPurchaseOrder({ authorization, repository })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });

  it("maps hidden, 501-bound, stale, invalid-cursor, and transport states", async () => {
    const detailAuthorization = await getPurchaseOrderAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_purchase_order_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "54000", message: "agent_purchase_order_source_bound" },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "40001", message: "agent_purchase_order_read_stale" },
        "STALE_CONTEXT",
      ],
    ] as const) {
      const repository = createSupabasePurchaseOrderReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        getPurchaseOrder({ authorization: detailAuthorization, repository })
      ).rejects.toMatchObject({ code });
    }

    const invalidCursorAuthorization = await listPurchaseOrdersAuthorization({
      cursor: "not-a-valid-cursor",
    });
    await expect(
      listPurchaseOrders({
        authorization: invalidCursorAuthorization,
        repository: createSupabasePurchaseOrderReadRepository(
          new StubRpcClient({ data: null, error: null })
        ),
        cursors,
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const failedRepository = createSupabasePurchaseOrderReadRepository(
      new StubRpcClient({ data: null, error: { code: "08006" } })
    );
    await expect(
      getPurchaseOrder({
        authorization: detailAuthorization,
        repository: failedRepository,
      })
    ).rejects.toBeInstanceOf(PurchaseOrderReadError);
  });
});
