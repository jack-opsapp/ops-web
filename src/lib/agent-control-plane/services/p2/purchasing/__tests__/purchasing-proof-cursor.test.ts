import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  createPurchaseOrderCursorService,
  PURCHASE_ORDER_RANKING_REVISION,
} from "../purchase-order-cursor";
import {
  exactPurchaseOrderSourceRevisions,
  purchaseOrderCollectionProofRef,
  purchaseOrderEntityProofRef,
  purchaseOrderEvidenceRef,
  purchaseOrderListProofContext,
} from "../purchase-order-proof";
import {
  PURCHASE_ORDER_ID,
  PURCHASING_BASE_REVISIONS,
  PURCHASING_COST_REVISIONS,
  PURCHASING_READ_AT,
  listPurchaseOrdersAuthorization,
  purchaseOrder,
} from "./purchasing-fixtures";

const CURSOR_TIME = 1_788_000_000;

describe("P2 purchase-order proof and cursor", () => {
  it("pins exact base/cost revisions and current cost witness in deterministic proofs", async () => {
    expect(PURCHASE_ORDER_RANKING_REVISION).toBe(
      "purchase-order-ranking:2026-08-22.v1"
    );
    expect(
      exactPurchaseOrderSourceRevisions(PURCHASING_BASE_REVISIONS, false)
    ).toEqual(PURCHASING_BASE_REVISIONS);
    expect(
      exactPurchaseOrderSourceRevisions(PURCHASING_COST_REVISIONS, true)
    ).toEqual(PURCHASING_COST_REVISIONS);
    expect(() =>
      exactPurchaseOrderSourceRevisions(PURCHASING_BASE_REVISIONS, true)
    ).toThrow("PURCHASE_ORDER_REVISION_VECTOR_INVALID");

    const authorization = await listPurchaseOrdersAuthorization({
      sections: ["costs"],
    });
    const context = purchaseOrderListProofContext({
      authorization,
      cursor: null,
      readAt: PURCHASING_READ_AT,
      sourceRevisions: PURCHASING_COST_REVISIONS,
      sourceInspected: { orders: 1, lines: 1, catalog_costs: 1 },
      sourceHasMore: false,
      catalogCostWitness: `sha256:${"c".repeat(64)}`,
    });
    const order = purchaseOrder(true);
    const entity = purchaseOrderEntityProofRef({ context, order });
    const evidence = purchaseOrderEvidenceRef({ context, order });
    const collection = purchaseOrderCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          purchase_order_ref: order.purchase_order_ref,
          proof_ref: entity,
          evidence_ref: evidence,
        },
      ],
    });
    expect(entity).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(collection).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(new Set([entity, evidence, collection]).size).toBe(3);
    expect(() =>
      purchaseOrderListProofContext({
        authorization,
        cursor: null,
        readAt: PURCHASING_READ_AT,
        sourceRevisions: PURCHASING_COST_REVISIONS,
        sourceInspected: { orders: 1, lines: 1, catalog_costs: 1 },
        sourceHasMore: false,
        catalogCostWitness: null,
      })
    ).toThrow("PURCHASE_ORDER_COST_WITNESS_INVALID");
  });

  it("round-trips a 15-minute cursor bound to selectors, authority, revisions, and delivery/time/id witness", async () => {
    const service = createPurchaseOrderCursorService({
      keyId: "purchasing-v1",
      key: new Uint8Array(32).fill(13),
    });
    const authorization = await listPurchaseOrdersAuthorization({
      statuses: ["draft", "sent"],
      supplier: { kind: "exact_label", value: "CanPro" },
      delivery_window: {
        starts_on: "2026-09-01",
        ends_on: "2026-09-30",
      },
      limit: 10,
    });
    const predecessor = {
      order: ["2026-09-03", PURCHASING_READ_AT, PURCHASE_ORDER_ID],
      tie_breaker: PURCHASE_ORDER_ID,
    } as const;
    const token = service.encode(
      {
        authorization,
        sourceRevisions: PURCHASING_BASE_REVISIONS,
        readAt: PURCHASING_READ_AT,
        predecessor,
      },
      CURSOR_TIME
    );
    expect(service.decode({ authorization, token }, CURSOR_TIME + 899)).toEqual(
      {
        readAt: PURCHASING_READ_AT,
        sourceRevisions: PURCHASING_BASE_REVISIONS,
        predecessor,
      }
    );
    expect(() =>
      service.decode({ authorization, token }, CURSOR_TIME + 900)
    ).toThrow(P2ReadCursorError);
    expect(() =>
      service.decode(
        { authorization, token: `${token.slice(0, -1)}x` },
        CURSOR_TIME + 1
      )
    ).toThrow(P2ReadCursorError);

    const changed = await listPurchaseOrdersAuthorization({
      statuses: ["draft", "sent"],
      supplier: { kind: "exact_label", value: "Other" },
      delivery_window: {
        starts_on: "2026-09-01",
        ends_on: "2026-09-30",
      },
      limit: 10,
    });
    expect(() =>
      service.decode({ authorization: changed, token }, CURSOR_TIME + 1)
    ).toThrow(P2ReadCursorError);
  });
});
