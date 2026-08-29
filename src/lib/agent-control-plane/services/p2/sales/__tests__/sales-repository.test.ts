import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  SalesDocumentReadRepositoryError,
  createSupabaseSalesDocumentReadRepository,
} from "../sales-repository";
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
import type { SalesDocumentCursorContext } from "../sales-cursor";
import {
  SALES_ACTOR_ID,
  SALES_CLIENT_ID,
  SALES_COMPANY_ID,
  SALES_DOCUMENT_ID,
  SALES_GRANT_ID,
  SALES_LINE_ID,
  SALES_MILESTONE_ID,
  SALES_PERMISSION_REVISION,
  SALES_READ_AT,
  SALES_SOURCE_REVISIONS,
  getSalesAuthorization,
  listSalesAuthorization,
  salesHeader,
} from "./sales-fixtures";

interface StubResponse {
  readonly data: unknown;
  readonly error: unknown;
}

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly signals: AbortSignal[] = [];
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
    request.abortSignal = (signal) => {
      this.signals.push(signal);
      return signal.aborted
        ? Promise.reject(new DOMException("Aborted", "AbortError"))
        : request;
    };
    return request;
  }
}

type ListAuthorization = Awaited<ReturnType<typeof listSalesAuthorization>>;
type DetailAuthorization = Awaited<ReturnType<typeof getSalesAuthorization>>;

function candidates(authorization: ListAuthorization | DetailAuthorization) {
  return authorization.authorizationCandidates.map((candidate) => ({
    variant_key: candidate.variantKey,
    required_oauth_scopes: candidate.requiredOAuthScopes,
    resolved_permission_scopes: candidate.resolvedPermissionScopes,
    satisfied_permission_group_indexes:
      candidate.satisfiedPermissionGroupIndexes,
  }));
}

function binding(authorization: ListAuthorization | DetailAuthorization) {
  const query =
    authorization.capabilityId === "list_sales_documents"
      ? (({ cursor: _cursor, ...value }) => value)(authorization.query)
      : authorization.query;
  return {
    company_id: SALES_COMPANY_ID,
    actor_user_id: SALES_ACTOR_ID,
    oauth_grant_id: SALES_GRANT_ID,
    oauth_client_id: SALES_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: SALES_PERMISSION_REVISION,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    authorization_candidates: candidates(authorization),
    query,
    read_at: SALES_READ_AT,
    source_revisions: SALES_SOURCE_REVISIONS,
  } as const;
}

function listRaw(
  authorization: ListAuthorization,
  overrides: Readonly<Record<string, unknown>> = {},
  cursor: SalesDocumentCursorContext | null = null
) {
  const item = salesHeader();
  const selected = authorization.authorizationCandidates[0];
  const sourceInspected = 1;
  const sourceHasMore = false;
  const context = salesDocumentListProofContext({
    authorization,
    cursor,
    readAt: SALES_READ_AT,
    sourceRevisions: SALES_SOURCE_REVISIONS,
    sourceInspected,
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
  const row = {
    item,
    selected_authorization_variant: selected.variantKey,
    authority_path: "opportunity",
    proof_ref: proofRef,
    evidence_ref: evidenceRef,
    predecessor: {
      order: [item.updated_at, item.document_ref.kind, item.document_ref.id],
      tie_breaker: item.document_ref.id,
    },
  } as const;
  return {
    ...binding(authorization),
    ranking_revision: "sales-document-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: cursor?.readAt ?? null,
    cursor_source_revisions: cursor?.sourceRevisions ?? [],
    cursor_predecessor: cursor?.predecessor ?? null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows: [row],
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
    ...overrides,
  };
}

function listRawForEstimateAndInvoice(authorization: ListAuthorization) {
  const items = [salesHeader("estimate"), salesHeader("invoice")] as const;
  const sourceInspected = items.length;
  const sourceHasMore = false;
  const context = salesDocumentListProofContext({
    authorization,
    cursor: null,
    readAt: SALES_READ_AT,
    sourceRevisions: SALES_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const rows = items.map((item) => {
    const selected = authorization.authorizationCandidates.find(
      (candidate) => candidate.variantKey === item.document_ref.kind
    )!;
    const authorityPath =
      item.document_ref.kind === "estimate" ? "opportunity" : "project";
    return {
      item,
      selected_authorization_variant: selected.variantKey,
      authority_path: authorityPath,
      proof_ref: salesDocumentEntityProofRef({
        context,
        item,
        selectedAuthorization: selected,
        authorityPath,
      }),
      evidence_ref: salesDocumentListEvidenceRef({
        context,
        item,
        selectedAuthorization: selected,
        authorityPath,
      }),
      predecessor: {
        order: [item.updated_at, item.document_ref.kind, item.document_ref.id],
        tie_breaker: item.document_ref.id,
      },
    } as const;
  });
  return {
    ...binding(authorization),
    ranking_revision: "sales-document-ranking:2026-08-22.v1",
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows,
    collection_proof_ref: salesDocumentCollectionProofRef({
      context,
      returnedCount: rows.length,
      hasMore: sourceHasMore,
      children: rows.map((row) => ({
        document_ref: row.item.document_ref,
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
  };
}

function detailSource() {
  return {
    document: salesHeader(),
    client_text: [
      {
        kind: "message",
        text: "Please approve before the expiry date.",
        content_kind: "untrusted_business_data",
      },
    ],
    lines: [
      {
        line_ref: { kind: "sales_document_line", id: SALES_LINE_ID },
        name: "Vinyl deck surface",
        description: "Includes perimeter trim.",
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

function detailRaw(
  authorization: DetailAuthorization,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const selected = authorization.authorizationCandidates[0];
  const sourceInspected = { documents: 1, lines: 1, milestones: 1 };
  const result = detailSource();
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
    result,
    proof_ref: salesDocumentDetailEntityProofRef({ context, result }),
    evidence_ref: salesDocumentDetailEvidenceRef({
      companyId: SALES_COMPANY_ID,
      documentRef: result.document.document_ref,
      updatedAt: result.document.updated_at,
    }),
    ...overrides,
  };
}

describe("P2 sales-document repository", () => {
  it("calls only fixed RPCs with exact actor, grant, policy, selectors, keyset, and 25/26/501 bounds", async () => {
    const authorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      customer_ref: {
        kind: "customer",
        id: "33333333-3333-4333-8333-333333333333",
      },
      job_ref: {
        kind: "opportunity",
        id: "77777777-7777-4777-8777-777777777777",
      },
      limit: 25,
    });
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseSalesDocumentReadRepository(client);
    await expect(
      repository.list({ authorization, cursor: null })
    ).resolves.toMatchObject({ state: "found" });
    expect(client.calls).toEqual([
      {
        functionName: "read_agent_sales_documents_as_system",
        args: expect.objectContaining({
          p_request_id: "request-sales-document-read",
          p_company_id: SALES_COMPANY_ID,
          p_actor_user_id: SALES_ACTOR_ID,
          p_oauth_grant_id: SALES_GRANT_ID,
          p_oauth_client_id: SALES_CLIENT_ID,
          p_grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_authorization_candidates: candidates(authorization),
          p_document_kinds: ["estimate"],
          p_customer_id: "33333333-3333-4333-8333-333333333333",
          p_job_kind: "opportunity",
          p_job_id: "77777777-7777-4777-8777-777777777777",
          p_item_limit: 25,
          p_page_fetch_limit: 26,
          p_source_limit: 501,
          p_cursor_read_at: null,
          p_after_updated_at: null,
          p_after_document_kind: null,
          p_after_document_id: null,
        }),
      },
    ]);
  });

  it("rejects binding, ordering, authority, query, revision, source-bound, and proof tampering", async () => {
    const authorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      limit: 25,
    });
    const base = listRaw(authorization);
    const invalid = [
      listRaw(authorization, {
        actor_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      listRaw(authorization, { source_inspected: 501 }),
      listRaw(authorization, { query: { ...authorization.query, limit: 24 } }),
      listRaw(authorization, { source_revisions: [SALES_SOURCE_REVISIONS[1]] }),
      listRaw(authorization, {
        rows: [{ ...base.rows[0], authority_path: "project" }],
      }),
      listRaw(authorization, {
        rows: [
          { ...base.rows[0], proof_ref: `ops_proof:v1:${"f".repeat(64)}` },
        ],
      }),
      listRaw(authorization, { rows: [base.rows[0], base.rows[0]] }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseSalesDocumentReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toBeInstanceOf(SalesDocumentReadRepositoryError);
    }
  });

  it("uses document kind plus id as identity when table-local UUIDs coincide", async () => {
    const authorization = await listSalesAuthorization();
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient([
        {
          data: listRawForEstimateAndInvoice(authorization),
          error: null,
        },
      ])
    );
    await expect(
      repository.list({ authorization, cursor: null })
    ).resolves.toMatchObject({
      state: "found",
      page: {
        units: [
          {
            item: { document_ref: { kind: "estimate", id: SALES_DOCUMENT_ID } },
          },
          {
            item: { document_ref: { kind: "invoice", id: SALES_DOCUMENT_ID } },
          },
        ],
      },
    });
  });

  it("accepts only the cursor-free SQL query binding and the exact decoded keyset fence", async () => {
    const authorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      cursor: "opaque-cursor-token",
      limit: 25,
    });
    const cursor: SalesDocumentCursorContext = {
      readAt: SALES_READ_AT,
      sourceRevisions: SALES_SOURCE_REVISIONS,
      predecessor: {
        order: [
          "2026-08-28T11:30:00.000Z",
          "estimate",
          "33333333-3333-4333-8333-333333333333",
        ],
        tie_breaker: "33333333-3333-4333-8333-333333333333",
      },
    };
    const client = new StubRpcClient([
      { data: listRaw(authorization, {}, cursor), error: null },
    ]);
    const repository = createSupabaseSalesDocumentReadRepository(client);
    await expect(
      repository.list({ authorization, cursor })
    ).resolves.toMatchObject({ state: "found" });
    expect(client.calls[0]?.args).toMatchObject({
      p_cursor_read_at: SALES_READ_AT,
      p_cursor_source_revisions: SALES_SOURCE_REVISIONS,
      p_after_updated_at: "2026-08-28T11:30:00.000Z",
      p_after_document_kind: "estimate",
      p_after_document_id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("returns strict ordered detail and fails closed on unlike currencies, private fields, and proof tampering", async () => {
    const authorization = await getSalesAuthorization();
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient([{ data: detailRaw(authorization), error: null }])
    );
    await expect(repository.get({ authorization })).resolves.toMatchObject({
      state: "found",
      value: {
        document: { document_ref: { kind: "estimate", id: SALES_DOCUMENT_ID } },
        lines: [{ quantity_milliunits: 12_500 }],
        milestones: [{ expected_date: "2026-08-30" }],
      },
    });

    const base = detailRaw(authorization);
    const source = detailSource();
    const invalid = [
      detailRaw(authorization, {
        result: {
          ...source,
          lines: [
            {
              ...source.lines[0],
              unit_price: { amount_minor: 10_000, currency: "USD" },
              line_total: { amount_minor: 125_000, currency: "USD" },
            },
          ],
        },
      }),
      detailRaw(authorization, {
        result: { ...source, internal_notes: "do not expose" },
      }),
      detailRaw(authorization, {
        proof_ref: `ops_proof:v1:${"e".repeat(64)}`,
      }),
      detailRaw(authorization, {
        selected_authorization_variant: "invoice",
      }),
      { ...base, source_inspected: { documents: 1, lines: 51, milestones: 1 } },
    ];
    for (const raw of invalid) {
      const candidate = createSupabaseSalesDocumentReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(candidate.get({ authorization })).rejects.toBeInstanceOf(
        SalesDocumentReadRepositoryError
      );
    }
  });

  it("maps only exact privacy-safe terminal errors and rejects borrowed authorization or abortion", async () => {
    const listAuthorization = await listSalesAuthorization({
      document_kinds: ["estimate"],
      limit: 25,
    });
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_sales_document_source_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_sales_document_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseSalesDocumentReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization: listAuthorization, cursor: null })
      ).resolves.toEqual({ state });
    }
    const detailAuthorization = await getSalesAuthorization();
    const repository = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_sales_document_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(
      repository.get({ authorization: detailAuthorization })
    ).resolves.toEqual({
      state: "not_found",
    });

    await expect(
      repository.list({
        authorization: { ...listAuthorization } as never,
        cursor: null,
      })
    ).rejects.toBeInstanceOf(SalesDocumentReadRepositoryError);

    const controller = new AbortController();
    controller.abort();
    const aborted = createSupabaseSalesDocumentReadRepository(
      new StubRpcClient([{ data: listRaw(listAuthorization), error: null }])
    );
    await expect(
      aborted.list({
        authorization: listAuthorization,
        cursor: null,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(SalesDocumentReadRepositoryError);
  });
});
