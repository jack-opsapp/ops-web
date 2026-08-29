import { describe, expect, it } from "vitest";

import {
  CatalogItemDetailResultSchema,
  CatalogSearchResultSchema,
} from "@/lib/agent-control-plane/contracts/catalog-purchasing";
import {
  createCatalogCursorService,
  type CatalogCursorContext,
} from "../catalog-cursor";
import {
  CatalogReadError,
  getCatalogItem,
  searchCatalogItems,
} from "../catalog-reads";
import { createSupabaseCatalogReadRepository } from "../catalog-repository";
import {
  catalogCollectionProofRef,
  catalogDetailEntityProofRef,
  catalogDetailEvidenceRef,
  catalogDetailProofContext,
  catalogListEvidenceRef,
  catalogListProofContext,
  catalogSearchEntityProofRef,
  type CatalogDetailSource,
} from "../catalog-proof";
import {
  CATALOG_COMPANY_ID,
  CATALOG_FAMILY_ID,
  CATALOG_PRODUCT_ID,
  CATALOG_READ_AT,
  CATALOG_SOURCE_REVISIONS,
  CATALOG_VARIANT_ID,
  catalogSearchItem,
  getCatalogAuthorization,
  searchCatalogAuthorization,
} from "./catalog-fixtures";

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
  | Awaited<ReturnType<typeof searchCatalogAuthorization>>
  | Awaited<ReturnType<typeof getCatalogAuthorization>>;
type CatalogDetailWithoutCosts = Exclude<
  CatalogDetailSource,
  { readonly supplier_costs: unknown }
>;
type CatalogDetailWithCosts = Extract<
  CatalogDetailSource,
  { readonly supplier_costs: unknown }
>;

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
  if (authorization.capabilityId !== "search_catalog_items") {
    return authorization.query;
  }
  const { cursor: _cursor, ...query } = authorization.query;
  return query;
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
    query: projectedQuery(authorization),
    read_at: CATALOG_READ_AT,
    source_revisions: CATALOG_SOURCE_REVISIONS,
  };
}

function rawList(
  authorization: Awaited<ReturnType<typeof searchCatalogAuthorization>>,
  sourceHasMore = false,
  cursor: CatalogCursorContext | null = null,
  items: readonly ReturnType<typeof catalogSearchItem>[] = [catalogSearchItem()]
) {
  const sourceInspected = items.length + (sourceHasMore ? 1 : 0);
  const context = catalogListProofContext({
    authorization,
    cursor,
    readAt: CATALOG_READ_AT,
    sourceRevisions: CATALOG_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const rows = items.map((item) => {
    const proofRef = catalogSearchEntityProofRef({ context, item });
    const evidenceRef = catalogListEvidenceRef({ context, item });
    return {
      item,
      selected_authorization_variant: "catalog" as const,
      proof_ref: proofRef,
      evidence_ref: evidenceRef,
      predecessor: {
        order: [item.updated_at, item.variant_ref.id] as const,
        tie_breaker: item.variant_ref.id,
      },
    };
  });
  return {
    ...binding(authorization),
    ranking_revision: "catalog-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: cursor?.readAt ?? null,
    cursor_source_revisions: cursor?.sourceRevisions ?? [],
    cursor_predecessor: cursor?.predecessor ?? null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows,
    collection_proof_ref: catalogCollectionProofRef({
      context,
      returnedCount: rows.length,
      hasMore: sourceHasMore,
      children: rows.map((row) => ({
        variant_ref: row.item.variant_ref,
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
  };
}

function detailSource(includeCosts: true): CatalogDetailWithCosts;
function detailSource(includeCosts: false): CatalogDetailWithoutCosts;
function detailSource(includeCosts: boolean): CatalogDetailSource;
function detailSource(includeCosts: boolean): CatalogDetailSource {
  const source: CatalogDetailWithoutCosts = {
    requested_ref: { kind: "catalog_family" as const, id: CATALOG_FAMILY_ID },
    family: {
      family_ref: { kind: "catalog_family" as const, id: CATALOG_FAMILY_ID },
      label: "Guardrail",
      description: "Exterior guardrail family",
      image_state: "available" as const,
      category: null,
      tags: ["Exterior", "Railing"],
      active: true,
      updated_at: CATALOG_READ_AT,
      content_kind: "untrusted_business_data" as const,
    },
    variants: [
      {
        variant_ref: {
          kind: "catalog_variant" as const,
          id: CATALOG_VARIANT_ID,
        },
        label: "Black · Topmount",
        sku: "RAIL-BLK-TOP",
        quantity_milliunits: 12_500,
        unit: { label: "Linear foot", abbreviation: "LF" },
        sale_price: { amount_minor: 1_899, currency: "CAD" },
        thresholds: {
          warning_milliunits: 20_000,
          critical_milliunits: 8_000,
          warning_origin: "family" as const,
          critical_origin: "category" as const,
        },
        stock_state: "warning" as const,
        active: true,
        updated_at: CATALOG_READ_AT,
        content_kind: "untrusted_business_data" as const,
      },
    ],
    options: [],
    recipes: [
      {
        product_ref: { kind: "product" as const, id: CATALOG_PRODUCT_ID },
        product_label: "Installed guardrail",
        relationship: "recipe" as const,
        variant_ref: {
          kind: "catalog_variant" as const,
          id: CATALOG_VARIANT_ID,
        },
        quantity_milliunits: 1_000,
        unit: { label: "Linear foot", abbreviation: "LF" },
        content_kind: "untrusted_business_data" as const,
      },
    ],
    physical_stock: [
      {
        variant_ref: {
          kind: "catalog_variant" as const,
          id: CATALOG_VARIANT_ID,
        },
        status: "partial" as const,
        unit_kind: "length" as const,
        location: "Yard A",
        lot_label: "LOT-12",
        quantity_milliunits: 5_500,
        content_kind: "untrusted_business_data" as const,
      },
    ],
  };
  if (includeCosts) {
    const withCosts: CatalogDetailWithCosts = {
      ...source,
      supplier_costs: [
        {
          variant_ref: {
            kind: "catalog_variant" as const,
            id: CATALOG_VARIANT_ID,
          },
          variant_label: "Black · Topmount",
          supplier_label: "CanPro",
          unit_cost: { amount_minor: 13_889, currency: "CAD" },
          basis: {
            kind: "variant_unit" as const,
            unit: { label: "Linear foot", abbreviation: "LF" },
          },
          effective_at: CATALOG_READ_AT,
          current: true as const,
          default: true,
          source_freshness: { observed_at: CATALOG_READ_AT },
          content_kind: "untrusted_business_data" as const,
        },
      ],
    };
    return withCosts;
  }
  return source;
}

function rawDetail(
  authorization: Awaited<ReturnType<typeof getCatalogAuthorization>>,
  source: CatalogDetailSource = detailSource(
    authorization.query.sections.includes("supplier_costs")
  )
) {
  const optionValues = source.options.reduce(
    (count, option) => count + option.values.length,
    0
  );
  const sourceInspected = {
    families: 1,
    variants: source.variants.length,
    options: source.options.length,
    option_values: optionValues,
    recipes: source.recipes.length,
    stock_units: source.physical_stock.length,
    supplier_costs:
      "supplier_costs" in source ? source.supplier_costs.length : 0,
  };
  const context = catalogDetailProofContext({
    authorization,
    readAt: CATALOG_READ_AT,
    sourceRevisions: CATALOG_SOURCE_REVISIONS,
    sourceInspected,
  });
  return {
    ...binding(authorization),
    selected_authorization_variants: authorization.variantKeys,
    source_inspected: sourceInspected,
    result: source,
    proof_ref: catalogDetailEntityProofRef({ context, result: source }),
    evidence_ref: catalogDetailEvidenceRef({
      companyId: CATALOG_COMPANY_ID,
      requestedRef: authorization.query.item_ref,
      familyUpdatedAt: source.family.updated_at,
    }),
  };
}

const cursors = createCatalogCursorService({
  keyId: "catalog-test",
  key: new Uint8Array(32).fill(11),
});

describe("P2 catalogue repository and services", () => {
  it("returns proof-coupled filtered search rows through only the fixed bounded RPC", async () => {
    const authorization = await searchCatalogAuthorization({
      query: { kind: "tag", value: "Railing" },
      stock_states: ["warning"],
      low_stock_only: true,
      limit: 1,
    });
    const client = new StubRpcClient({
      data: rawList(authorization, true),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);
    const result = await searchCatalogItems({
      authorization,
      repository,
      cursors,
    });
    expect(CatalogSearchResultSchema.parse(result)).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      name: "read_agent_catalog_items_as_system",
      args: {
        p_query_kind: "tag",
        p_query_value: "Railing",
        p_item_limit: 1,
        p_page_fetch_limit: 2,
        p_source_limit: 501,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("reduces only complete catalogue item/proof/evidence units at the serializer boundary", async () => {
    const authorization = await searchCatalogAuthorization({ limit: 3 });
    const largeTags = Array.from(
      { length: 64 },
      (_, index) => `${String(index).padStart(2, "0")}${"😀".repeat(158)}`
    );
    const oversizedItems = Array.from({ length: 3 }, (_, index) => ({
      ...catalogSearchItem(),
      family_label: "😀".repeat(256),
      variant_ref: {
        kind: "catalog_variant" as const,
        id: `18000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
      },
      variant_label: "😀".repeat(256),
      category: null,
      sku: null,
      unit: null,
      tags: largeTags,
    }));
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({
        data: rawList(authorization, false, null, oversizedItems),
        error: null,
      })
    );

    const result = await searchCatalogItems({
      authorization,
      repository,
      cursors,
    });

    expect(result.items).toHaveLength(2);
    expect(result.item_proofs).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.collection_proof).toMatchObject({
      returned_count: 2,
      has_more: true,
    });
    expect(result.items.map((item) => item.variant_ref.id)).toEqual(
      oversizedItems.slice(0, 2).map((item) => item.variant_ref.id)
    );
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
  });

  it("binds a cursor page to the SQL-projected query without accepting the opaque cursor as repository proof data", async () => {
    const firstAuthorization = await searchCatalogAuthorization({ limit: 1 });
    const token = cursors.encode({
      authorization: firstAuthorization,
      sourceRevisions: CATALOG_SOURCE_REVISIONS,
      readAt: CATALOG_READ_AT,
      predecessor: {
        order: ["2026-08-28T21:00:00.000Z", CATALOG_FAMILY_ID],
        tie_breaker: CATALOG_FAMILY_ID,
      },
    });
    const authorization = await searchCatalogAuthorization({
      limit: 1,
      cursor: token,
    });
    const cursor = cursors.decode({ authorization, token });
    const client = new StubRpcClient({
      data: rawList(authorization, false, cursor),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);

    await expect(
      searchCatalogItems({ authorization, repository, cursors })
    ).resolves.toMatchObject({ items: [catalogSearchItem()] });
    expect(client.calls[0]?.args).toMatchObject({
      p_cursor_read_at: CATALOG_READ_AT,
      p_cursor_source_revisions: CATALOG_SOURCE_REVISIONS,
      p_after_updated_at: "2026-08-28T21:00:00.000Z",
      p_after_variant_id: CATALOG_FAMILY_ID,
    });
  });

  it("returns safe detail without any cost field when the cost section is absent", async () => {
    const authorization = await getCatalogAuthorization();
    const client = new StubRpcClient({
      data: rawDetail(authorization),
      error: null,
    });
    const repository = createSupabaseCatalogReadRepository(client);
    const result = await getCatalogItem({ authorization, repository });
    expect(CatalogItemDetailResultSchema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty("supplier_costs");
    expect(client.calls[0]).toMatchObject({
      name: "read_agent_catalog_item_as_system",
      args: {
        p_item_kind: "catalog_family",
        p_item_id: CATALOG_FAMILY_ID,
        p_include_supplier_costs: false,
        p_source_limit: 501,
      },
    });
  });

  it("returns exact supplier money only after the separate OAuth and financial binding", async () => {
    const authorization = await getCatalogAuthorization({
      includeCosts: true,
    });
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({ data: rawDetail(authorization), error: null })
    );
    const result = await getCatalogItem({ authorization, repository });
    expect(result).toMatchObject({
      supplier_costs: [
        {
          supplier_label: "CanPro",
          unit_cost: { amount_minor: 13_889, currency: "CAD" },
          default: true,
        },
      ],
    });
  });

  it("rejects an indivisible detail result above the exact serializer budget", async () => {
    const authorization = await getCatalogAuthorization();
    const largeLabel = "😀".repeat(256);
    const oversizedSource = {
      ...detailSource(false),
      options: Array.from({ length: 32 }, (_, optionIndex) => ({
        option_ref: {
          kind: "catalog_option" as const,
          id: `18000000-0000-4000-8000-${String(optionIndex + 100).padStart(12, "0")}`,
        },
        label: largeLabel,
        sort_order: optionIndex,
        values: Array.from({ length: 8 }, (_, valueIndex) => ({
          value_ref: {
            kind: "catalog_option_value" as const,
            id: `18000000-0000-4000-8000-${String(
              1_000 + optionIndex * 8 + valueIndex
            ).padStart(12, "0")}`,
          },
          label: largeLabel,
          sort_order: valueIndex,
          content_kind: "untrusted_business_data" as const,
        })),
        content_kind: "untrusted_business_data" as const,
      })),
    };
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({
        data: rawDetail(authorization, oversizedSource),
        error: null,
      })
    );

    await expect(
      getCatalogItem({ authorization, repository })
    ).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });

  it("maps hidden, 501-bound, stale, invalid-cursor, and transport states without leaking source rows", async () => {
    const detailAuthorization = await getCatalogAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_catalog_item_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "54000", message: "agent_catalog_source_bound" },
        "RESULT_TOO_LARGE",
      ],
      [{ code: "40001", message: "agent_catalog_read_stale" }, "STALE_CONTEXT"],
    ] as const) {
      const repository = createSupabaseCatalogReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        getCatalogItem({ authorization: detailAuthorization, repository })
      ).rejects.toMatchObject({ code });
    }

    const searchAuthorization = await searchCatalogAuthorization({
      cursor: "not-a-valid-cursor",
    });
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({ data: null, error: null })
    );
    await expect(
      searchCatalogItems({
        authorization: searchAuthorization,
        repository,
        cursors,
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("rejects proof tampering, cost injection, reconstructed authority, and untrusted repositories", async () => {
    const baseAuthorization = await getCatalogAuthorization();
    const injected = {
      ...detailSource(false),
      supplier_costs: detailSource(true).supplier_costs,
    };
    for (const data of [
      {
        ...rawDetail(baseAuthorization),
        proof_ref: `ops_proof:v1:${"f".repeat(64)}`,
      },
      rawDetail(baseAuthorization, injected),
    ]) {
      const repository = createSupabaseCatalogReadRepository(
        new StubRpcClient({ data, error: null })
      );
      await expect(
        getCatalogItem({ authorization: baseAuthorization, repository })
      ).rejects.toBeInstanceOf(CatalogReadError);
    }
    const repository = createSupabaseCatalogReadRepository(
      new StubRpcClient({ data: rawDetail(baseAuthorization), error: null })
    );
    await expect(
      getCatalogItem({
        authorization: { ...baseAuthorization } as never,
        repository,
      })
    ).rejects.toBeInstanceOf(CatalogReadError);
    await expect(
      getCatalogItem({
        authorization: baseAuthorization,
        repository: {
          get: async () => ({ state: "not_found" as const }),
        } as never,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("rejects coherently re-proved cursor-page and requested-item substitutions", async () => {
    const firstAuthorization = await searchCatalogAuthorization({ limit: 1 });
    const repeatedPredecessor = {
      order: [CATALOG_READ_AT, CATALOG_VARIANT_ID] as const,
      tie_breaker: CATALOG_VARIANT_ID,
    };
    const token = cursors.encode({
      authorization: firstAuthorization,
      sourceRevisions: CATALOG_SOURCE_REVISIONS,
      readAt: CATALOG_READ_AT,
      predecessor: repeatedPredecessor,
    });
    const cursorAuthorization = await searchCatalogAuthorization({
      limit: 1,
      cursor: token,
    });
    const cursor = cursors.decode({
      authorization: cursorAuthorization,
      token,
    });
    await expect(
      searchCatalogItems({
        authorization: cursorAuthorization,
        repository: createSupabaseCatalogReadRepository(
          new StubRpcClient({
            data: rawList(cursorAuthorization, false, cursor),
            error: null,
          })
        ),
        cursors,
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });

    const detailAuthorization = await getCatalogAuthorization();
    const substituted = detailSource(false);
    const unrelatedFamilyId = "18100000-0000-4000-8000-000000000012";
    const substitutedSource = {
      ...substituted,
      requested_ref: {
        kind: "catalog_family" as const,
        id: unrelatedFamilyId,
      },
      family: {
        ...substituted.family,
        family_ref: {
          kind: "catalog_family" as const,
          id: unrelatedFamilyId,
        },
      },
    };
    await expect(
      getCatalogItem({
        authorization: detailAuthorization,
        repository: createSupabaseCatalogReadRepository(
          new StubRpcClient({
            data: rawDetail(detailAuthorization, substitutedSource),
            error: null,
          })
        ),
      })
    ).rejects.toMatchObject({ code: "TEMPORARILY_UNAVAILABLE" });
  });
});
