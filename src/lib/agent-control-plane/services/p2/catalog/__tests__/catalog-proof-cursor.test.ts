import { describe, expect, it } from "vitest";

import { P2ReadCursorError } from "../../shared/cursor";
import {
  CATALOG_RANKING_REVISION,
  createCatalogCursorService,
} from "../catalog-cursor";
import {
  catalogCollectionProofRef,
  catalogListEvidenceRef,
  catalogListProofContext,
  catalogSearchEntityProofRef,
  exactCatalogSourceRevisions,
} from "../catalog-proof";
import {
  CATALOG_READ_AT,
  CATALOG_SOURCE_REVISIONS,
  catalogSearchItem,
  searchCatalogAuthorization,
} from "./catalog-fixtures";

const CURSOR_TIME = 1_787_950_000;

describe("P2 catalogue proof and cursor", () => {
  it("pins one exact catalogue revision and deterministic proof material", async () => {
    expect(CATALOG_RANKING_REVISION).toBe("catalog-ranking:2026-08-22.v1");
    expect(exactCatalogSourceRevisions(CATALOG_SOURCE_REVISIONS)).toEqual(
      CATALOG_SOURCE_REVISIONS
    );
    expect(() =>
      exactCatalogSourceRevisions([
        { domain: "catalog", source_revision: 1 },
        { domain: "legacy_operational", source_revision: 1 },
      ])
    ).toThrow("CATALOG_REVISION_VECTOR_INVALID");

    const authorization = await searchCatalogAuthorization({
      query: { kind: "tag", value: "Railing" },
    });
    const context = catalogListProofContext({
      authorization,
      cursor: null,
      readAt: CATALOG_READ_AT,
      sourceRevisions: CATALOG_SOURCE_REVISIONS,
      sourceInspected: 1,
      sourceHasMore: false,
    });
    const item = catalogSearchItem();
    const entity = catalogSearchEntityProofRef({ context, item });
    const evidence = catalogListEvidenceRef({ context, item });
    const collection = catalogCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          variant_ref: item.variant_ref,
          proof_ref: entity,
          evidence_ref: evidence,
        },
      ],
    });
    expect(entity).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(evidence).toMatch(/^ops_evidence:v1:[0-9a-f]{64}$/);
    expect(collection).toMatch(/^ops_proof:v1:[0-9a-f]{64}$/);
    expect(new Set([entity, evidence, collection]).size).toBe(3);
  });

  it("round-trips a 15-minute cursor bound to filters, authority, revisions, and order witness", async () => {
    const service = createCatalogCursorService({
      keyId: "catalog-v1",
      key: new Uint8Array(32).fill(7),
    });
    const authorization = await searchCatalogAuthorization({
      query: { kind: "sku", value: "RAIL-BLK-TOP" },
      active_state: "active",
      stock_states: ["critical", "warning"],
      low_stock_only: true,
      limit: 10,
    });
    const predecessor = {
      order: [CATALOG_READ_AT, catalogSearchItem().variant_ref.id],
      tie_breaker: catalogSearchItem().variant_ref.id,
    } as const;
    const token = service.encode(
      {
        authorization,
        sourceRevisions: CATALOG_SOURCE_REVISIONS,
        readAt: CATALOG_READ_AT,
        predecessor,
      },
      CURSOR_TIME
    );
    expect(service.decode({ authorization, token }, CURSOR_TIME + 899)).toEqual(
      {
        readAt: CATALOG_READ_AT,
        sourceRevisions: CATALOG_SOURCE_REVISIONS,
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

    const changedFilters = await searchCatalogAuthorization({
      query: { kind: "sku", value: "RAIL-BLK-TOP" },
      active_state: "all",
      stock_states: ["critical", "warning"],
      low_stock_only: true,
      limit: 10,
    });
    expect(() =>
      service.decode({ authorization: changedFilters, token }, CURSOR_TIME + 1)
    ).toThrow(P2ReadCursorError);

    const revisedGrant = {
      ...authorization,
      grantRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    } as typeof authorization;
    expect(() =>
      service.decode({ authorization: revisedGrant, token }, CURSOR_TIME + 1)
    ).toThrow(P2ReadCursorError);
  });
});
