import { describe, expect, it } from "vitest";

import {
  GetSalesDocumentResultSchema,
  ListSalesDocumentsResultSchema,
} from "@/lib/agent-control-plane/contracts/sales-documents";
import { createSalesDocumentCursorService } from "../sales-cursor";
import {
  SalesDocumentReadError,
  getSalesDocument,
  listSalesDocuments,
} from "../sales-reads";
import { createSupabaseSalesDocumentReadRepository } from "../sales-repository";
import {
  salesDocumentCollectionProofRef,
  salesDocumentDetailEntityProofRef,
  salesDocumentDetailEvidenceRef,
  salesDocumentDetailProofContext,
  salesDocumentEntityProofRef,
  salesDocumentListEvidenceRef,
  salesDocumentListProofContext,
  type SalesDocumentDetailSource,
} from "../sales-proof";
import {
  SALES_COMPANY_ID,
  SALES_LINE_ID,
  SALES_MILESTONE_ID,
  SALES_READ_AT,
  SALES_SOURCE_REVISIONS,
  getSalesAuthorization,
  listSalesAuthorization,
  salesHeader,
} from "./sales-fixtures";

class StubRpcClient {
  constructor(
    private readonly response: Readonly<{ data: unknown; error: unknown }>
  ) {}
  rpc() {
    return Promise.resolve(this.response);
  }
}

function candidates(
  authorization:
    | Awaited<ReturnType<typeof listSalesAuthorization>>
    | Awaited<ReturnType<typeof getSalesAuthorization>>
) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function binding(
  authorization:
    | Awaited<ReturnType<typeof listSalesAuthorization>>
    | Awaited<ReturnType<typeof getSalesAuthorization>>
) {
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
    query: authorization.query,
    read_at: SALES_READ_AT,
    source_revisions: SALES_SOURCE_REVISIONS,
  };
}

function rawList(
  authorization: Awaited<ReturnType<typeof listSalesAuthorization>>,
  sourceHasMore = false
) {
  const item = salesHeader();
  const selected = authorization.authorizationCandidates[0];
  const context = salesDocumentListProofContext({
    authorization,
    cursor: null,
    readAt: SALES_READ_AT,
    sourceRevisions: SALES_SOURCE_REVISIONS,
    sourceInspected: 1,
    sourceHasMore,
  });
  const proofRef = salesDocumentEntityProofRef({
    context,
    item,
    selectedAuthorization: selected,
    authorityPath: "opportunity",
  });
  const evidenceRef = salesDocumentListEvidenceRef({
    context,
    item,
    selectedAuthorization: selected,
    authorityPath: "opportunity",
  });
  return {
    ...binding(authorization),
    ranking_revision: "sales-document-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 1,
    source_has_more: sourceHasMore,
    rows: [
      {
        item,
        selected_authorization_variant: selected.variantKey,
        authority_path: "opportunity",
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor: {
          order: [
            item.updated_at,
            item.document_ref.kind,
            item.document_ref.id,
          ],
          tie_breaker: item.document_ref.id,
        },
      },
    ],
    collection_proof_ref: salesDocumentCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: sourceHasMore,
      children: [
        {
          document_ref: item.document_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
  };
}

function detailSource(message = "Please approve before the expiry date.") {
  return {
    document: salesHeader(),
    client_text: [
      {
        kind: "message",
        text: message,
        content_kind: "untrusted_business_data",
      },
    ],
    lines: [
      {
        line_ref: { kind: "sales_document_line", id: SALES_LINE_ID },
        name: "Vinyl deck surface",
        description: null,
        quantity_milliunits: 12_500,
        unit: "sqft",
        unit_price: { amount_minor: 10_000, currency: "CAD" },
        line_total: { amount_minor: 125_000, currency: "CAD" },
        discount_basis_points: 0,
        is_taxable: true,
        is_optional: false,
        is_selected: true,
        sort_order: 0,
        content_kind: "untrusted_business_data",
      },
    ],
    milestones: [
      {
        milestone_ref: {
          kind: "estimate_payment_milestone",
          id: SALES_MILESTONE_ID,
        },
        name: "Deposit",
        schedule_value: { kind: "percentage", basis_points: 5_000 },
        amount: { amount_minor: 62_500, currency: "CAD" },
        expected_date: "2026-08-30",
        state: "pending",
        paid_at: null,
        sort_order: 0,
        content_kind: "untrusted_business_data",
      },
    ],
  } satisfies SalesDocumentDetailSource;
}

function rawDetail(
  authorization: Awaited<ReturnType<typeof getSalesAuthorization>>,
  source = detailSource()
) {
  const selected = authorization.authorizationCandidates[0];
  const sourceInspected = { documents: 1, lines: 1, milestones: 1 };
  const context = salesDocumentDetailProofContext({
    authorization,
    selectedAuthorization: selected,
    authorityPath: "opportunity",
    readAt: SALES_READ_AT,
    sourceRevisions: SALES_SOURCE_REVISIONS,
    sourceInspected,
  });
  return {
    ...binding(authorization),
    selected_authorization_variant: selected.variantKey,
    authority_path: "opportunity",
    source_inspected: sourceInspected,
    result: source,
    proof_ref: salesDocumentDetailEntityProofRef({ context, result: source }),
    evidence_ref: salesDocumentDetailEvidenceRef({
      companyId: SALES_COMPANY_ID,
      documentRef: source.document.document_ref,
      updatedAt: source.document.updated_at,
    }),
  };
}

const cursors = createSalesDocumentCursorService({
  keyId: "sales-test-key",
  key: new Uint8Array(32).fill(9),
});

describe("P2 sales-document read services", () => {
  it("returns a strict proof-coupled list and emits an opaque next cursor", async () => {
    const authorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      limit: 1,
    });
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient({ data: rawList(authorization, true), error: null })
    );
    const result = await listSalesDocuments({
      authorization,
      repository,
      cursors,
    });
    expect(ListSalesDocumentsResultSchema.parse(result)).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.next_cursor).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns a strict detail and preserves ordered lines, milestones, and canonical money", async () => {
    const authorization = await getSalesAuthorization();
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient({ data: rawDetail(authorization), error: null })
    );
    const result = await getSalesDocument({ authorization, repository });
    expect(GetSalesDocumentResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      document: { total: { amount_minor: 125_000, currency: "CAD" } },
      lines: [{ quantity_milliunits: 12_500 }],
      milestones: [{ expected_date: "2026-08-30" }],
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("maps exact terminal states and cursor failures without existence leakage", async () => {
    const listAuthorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      cursor: "not-a-valid-cursor",
      limit: 1,
    });
    const listRepository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient({ data: null, error: null })
    );
    await expect(
      listSalesDocuments({
        authorization: listAuthorization,
        repository: listRepository,
        cursors,
      })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });

    const detailAuthorization = await getSalesAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_sales_document_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "54000", message: "agent_sales_document_source_bound" },
        "RESULT_TOO_LARGE",
      ],
      [
        { code: "40001", message: "agent_sales_document_read_stale" },
        "STALE_CONTEXT",
      ],
    ] as const) {
      const repository = createSupabaseSalesDocumentReadRepository(
        new StubRpcClient({ data: null, error })
      );
      await expect(
        getSalesDocument({ authorization: detailAuthorization, repository })
      ).rejects.toMatchObject({ code });
    }
  });

  it("rejects reconstructed authority and untrusted repositories", async () => {
    const authorization = await getSalesAuthorization();
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient({ data: rawDetail(authorization), error: null })
    );
    await expect(
      getSalesDocument({
        authorization: { ...authorization } as never,
        repository,
      })
    ).rejects.toBeInstanceOf(SalesDocumentReadError);
    await expect(
      getSalesDocument({
        authorization,
        repository: {
          get: async () => ({ state: "not_found" as const }),
        } as never,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
