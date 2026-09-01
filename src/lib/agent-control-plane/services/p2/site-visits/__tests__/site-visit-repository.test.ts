import { describe, expect, it } from "vitest";

import type { GetSiteVisitContextResult } from "@/lib/agent-control-plane/contracts/site-visits";

import {
  createSupabaseSiteVisitReadRepository,
  SiteVisitReadRepositoryError,
} from "../site-visit-repository";
import {
  siteVisitContextEntityProofRef,
  siteVisitContextEvidenceRef,
  siteVisitContextProofContext,
  siteVisitListCollectionProofRef,
  siteVisitListEntityProofRef,
  siteVisitListEvidenceRef,
  siteVisitListProofContext,
  siteVisitListQueryProjection,
} from "../site-visit-proof";
import {
  linkedBookedVisitSummary,
  listSiteVisitsAuthorization,
  SITE_VISIT_ACTOR_ID,
  SITE_VISIT_ARTIFACT_SOURCE_REVISIONS,
  SITE_VISIT_COMPANY_ID,
  SITE_VISIT_GRANT_ID,
  SITE_VISIT_ID,
  SITE_VISIT_OAUTH_CLIENT_ID,
  SITE_VISIT_OPPORTUNITY_ID,
  SITE_VISIT_PERMISSION_REVISION,
  SITE_VISIT_READ_AT,
  SITE_VISIT_SOURCE_REVISIONS,
  siteVisitContextAuthorization,
} from "./site-visit-fixtures";

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected site-visit RPC");
    const request = Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
  }
}

type ListAuthorization = Awaited<
  ReturnType<typeof listSiteVisitsAuthorization>
>;
type ContextAuthorization = Awaited<
  ReturnType<typeof siteVisitContextAuthorization>
>;

function binding(
  authorization: ListAuthorization | ContextAuthorization,
  sourceRevisions: readonly {
    readonly domain: "artifacts" | "site_visits";
    readonly source_revision: number;
  }[]
) {
  return {
    company_id: SITE_VISIT_COMPANY_ID,
    actor_user_id: SITE_VISIT_ACTOR_ID,
    oauth_grant_id: SITE_VISIT_GRANT_ID,
    oauth_client_id: SITE_VISIT_OAUTH_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    permission_snapshot_revision: SITE_VISIT_PERMISSION_REVISION,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    required_oauth_scopes: [...authorization.requiredOAuthScopes],
    calendar_scope: authorization.calendarScope,
    clients_scope: authorization.clientsScope,
    deck_builder_scope: authorization.deckBuilderScope,
    pipeline_scope: authorization.pipelineScope,
    photos_scope: authorization.photosScope,
    read_at: SITE_VISIT_READ_AT,
    source_revisions: sourceRevisions,
  } as const;
}

function listRaw(
  authorization: ListAuthorization,
  overrides: Record<string, unknown> = {}
) {
  const item = linkedBookedVisitSummary();
  const query = siteVisitListQueryProjection(authorization);
  const context = siteVisitListProofContext({
    authorization,
    cursor: null,
    readAt: SITE_VISIT_READ_AT,
    sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
    sourceInspected: 1,
    sourceHasMore: false,
  });
  const proofRef = siteVisitListEntityProofRef({ context, visit: item });
  const evidenceRef = siteVisitListEvidenceRef({
    context,
    siteVisitRef: item.site_visit_ref,
  });
  const predecessor = {
    view: "booked_appointments",
    order: [item.booking.booked_at, SITE_VISIT_ID],
    tie_breaker: SITE_VISIT_ID,
  } as const;
  return {
    ...binding(authorization, SITE_VISIT_SOURCE_REVISIONS),
    query,
    item_limit: 25,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 1,
    source_has_more: false,
    rows: [
      { item, proof_ref: proofRef, evidence_ref: evidenceRef, predecessor },
    ],
    collection_proof_ref: siteVisitListCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: false,
      children: [
        {
          site_visit_ref: item.site_visit_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
    ...overrides,
  };
}

function contextResult(): Omit<
  GetSiteVisitContextResult,
  "evidence" | "proof"
> {
  const visit = linkedBookedVisitSummary();
  return {
    visit,
    sections: {
      artifact_summary: {
        source_count: 2,
        kind_counts: [
          { kind: "deck_design", count: 1 },
          { kind: "photo", count: 1 },
        ],
        review_inclusion: { included_count: 1, not_included_count: 1 },
      },
      deck_design_refs: [
        { deck_design_ref: `ops_deck_design:v1:${"c".repeat(64)}` },
      ],
      notes: {
        state: "recorded",
        text: "Use glass on the back deck.",
        truncated: false,
        content_kind: "untrusted_business_data",
      },
    },
  };
}

function checklistContextResult(): Omit<
  GetSiteVisitContextResult,
  "evidence" | "proof"
> {
  return {
    visit: linkedBookedVisitSummary(),
    sections: {
      checklist_answers: {
        source_count: 2,
        source_has_more: false,
        returned_count: 2,
        result_budget_omitted_count: 0,
        answers: [
          {
            field_ref: `ops_site_visit_field:v1:${"a".repeat(32)}`,
            label: "Gate width",
            kind: "measurement",
            required: true,
            answer: {
              state: "recorded",
              value_kind: "text",
              text: "42 inches",
              truncated: false,
              content_kind: "untrusted_business_data",
            },
            content_kind: "untrusted_business_data",
          },
          {
            field_ref: `ops_site_visit_field:v1:${"b".repeat(32)}`,
            label: "Confirm stairs",
            kind: "checkbox",
            required: false,
            answer: { state: "not_answered" },
            content_kind: "untrusted_business_data",
          },
        ],
      },
      checklist_summary: {
        total_count: 2,
        answered_count: 1,
        required_count: 1,
        required_answered_count: 1,
        completion: "incomplete",
      },
    },
  };
}

function contextRaw(
  authorization: ContextAuthorization,
  overrides: Record<string, unknown> = {}
) {
  const result = contextResult();
  const sourceInspected = {
    artifacts: 2,
    checklist_answers: 0,
    deck_designs: 1,
    visits: 1,
  } as const;
  return {
    ...signedContextRaw(authorization, result, sourceInspected),
    ...overrides,
  };
}

function signedContextRaw(
  authorization: ContextAuthorization,
  result: Omit<GetSiteVisitContextResult, "evidence" | "proof">,
  sourceInspected: {
    readonly artifacts: number;
    readonly checklist_answers: number;
    readonly deck_designs: number;
    readonly visits: number;
  }
) {
  const artifactSelected =
    authorization.query.sections.includes("artifact_summary") ||
    authorization.query.sections.includes("deck_design_refs");
  const sourceRevisions = artifactSelected
    ? SITE_VISIT_ARTIFACT_SOURCE_REVISIONS
    : SITE_VISIT_SOURCE_REVISIONS;
  const context = siteVisitContextProofContext({
    authorization,
    readAt: SITE_VISIT_READ_AT,
    sourceRevisions,
    sourceInspected,
  });
  const query = authorization.query;
  return {
    ...binding(authorization, sourceRevisions),
    anchor: query.anchor,
    opportunity_ref:
      query.anchor === "opportunity" ? query.opportunity_ref : null,
    site_visit_ref: query.site_visit_ref,
    selected_sections: query.sections,
    checklist_answer_limit: query.checklist_answer_limit ?? null,
    timeline_limit: query.timeline_limit ?? null,
    source_inspected: sourceInspected,
    result,
    proof_ref: siteVisitContextEntityProofRef({ context, result }),
    evidence_ref: siteVisitContextEvidenceRef({ context }),
  };
}

describe("P2 site-visit list repository", () => {
  it("calls only the literal list RPC with booked_at filters, current grant/policy authority, and 25/26/501 bounds", async () => {
    const authorization = await listSiteVisitsAuthorization();
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseSiteVisitReadRepository(client);
    const result = await repository.list({ authorization, cursor: null });

    expect(result).toMatchObject({
      state: "found",
      page: {
        readAt: SITE_VISIT_READ_AT,
        sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
        sourceHasMore: false,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_site_visits_as_system",
      args: expect.objectContaining({
        p_actor_user_id: SITE_VISIT_ACTOR_ID,
        p_company_id: SITE_VISIT_COMPANY_ID,
        p_oauth_grant_id: SITE_VISIT_GRANT_ID,
        p_oauth_client_id: SITE_VISIT_OAUTH_CLIENT_ID,
        p_permission_snapshot_revision: SITE_VISIT_PERMISSION_REVISION,
        p_capability_id: "list_site_visits",
        p_view_kind: "booked_appointments",
        p_window_from: "2026-08-20T00:00:00.000Z",
        p_window_to: "2026-08-30T00:00:00.000Z",
        p_item_limit: 25,
        p_page_fetch_limit: 26,
        p_source_limit: 501,
        p_cursor_read_at: null,
        p_after_order_at: null,
        p_after_site_visit_id: null,
      }),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects authority/query/order/proof/evidence/revision/privacy/501 and cursor-echo tampering", async () => {
    const authorization = await listSiteVisitsAuthorization();
    const exact = listRaw(authorization);
    const invalid = [
      listRaw(authorization, {
        actor_user_id: "99999999-9999-4999-8999-999999999999",
      }),
      listRaw(authorization, { source_inspected: 501 }),
      listRaw(authorization, {
        query: { ...exact.query, view: "visit_history" },
      }),
      listRaw(authorization, {
        source_revisions: [{ domain: "artifacts", source_revision: 1 }],
      }),
      listRaw(authorization, {
        rows: [{ ...exact.rows[0], proof_ref: exact.collection_proof_ref }],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            evidence_ref: `ops_evidence:v1:${"F".repeat(64)}`,
          },
        ],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            item: {
              ...exact.rows[0]!.item,
              attendees: [{ email: "private@example.com" }],
            },
          },
        ],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...exact.rows[0],
            predecessor: {
              ...exact.rows[0]!.predecessor,
              order: ["2026-08-24T08:00:00.000Z", SITE_VISIT_ID],
            },
          },
        ],
      }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(SiteVisitReadRepositoryError);
    }
  });

  it("maps only exact source-bound and stale errors to safe states", async () => {
    const authorization = await listSiteVisitsAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_site_visit_source_query_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_site_visit_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({ state });
    }
  });
});

describe("P2 site-visit context repository", () => {
  it("calls one literal context RPC and returns only the strict artifact/deck projection with exact revisions", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs", "notes"],
    });
    const raw = contextRaw(authorization);
    const client = new StubRpcClient([{ data: raw, error: null }]);
    const repository = createSupabaseSiteVisitReadRepository(client);
    const result = await repository.get({ authorization });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_site_visit_context_as_system",
      args: expect.objectContaining({
        p_site_visit_id: SITE_VISIT_ID,
        p_expected_anchor: "opportunity",
        p_expected_opportunity_id: SITE_VISIT_OPPORTUNITY_ID,
        p_sections: ["artifact_summary", "deck_design_refs", "notes"],
        p_source_limit: 501,
        p_artifact_source_limit: 501,
        p_checklist_answer_limit: 0,
        p_timeline_limit: 0,
      }),
    });
    expect(result).toMatchObject({
      state: "found",
      value: {
        visit: { site_visit_ref: { id: SITE_VISIT_ID } },
        sections: {
          deck_design_refs: [
            { deck_design_ref: `ops_deck_design:v1:${"c".repeat(64)}` },
          ],
        },
        proof: { proof_ref: raw.proof_ref },
      },
    });
    expect(result).toHaveProperty("proofBinding");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps hidden/nonexistent indistinguishable and rejects unselected/leaked/malformed private rows", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs", "notes"],
    });
    const exact = contextRaw(authorization);
    const invalid = [
      contextRaw(authorization, { selected_sections: ["notes"] }),
      contextRaw(authorization, {
        source_inspected: {
          artifacts: 501,
          checklist_answers: 0,
          deck_designs: 1,
          visits: 1,
        },
      }),
      contextRaw(authorization, {
        result: {
          ...exact.result,
          sections: { ...exact.result.sections, geometry: { edges: [] } },
        },
      }),
      contextRaw(authorization, {
        result: {
          ...exact.result,
          sections: {
            ...exact.result.sections,
            raw_photos: ["https://storage.test/photo.jpg"],
          },
        },
      }),
      contextRaw(authorization, {
        proof_ref: `ops_proof:v1:${"E".repeat(64)}`,
      }),
      contextRaw(authorization, {
        evidence_ref: `ops_evidence:v1:${"F".repeat(64)}`,
      }),
      contextRaw(authorization, {
        source_revisions: [{ domain: "site_visits", source_revision: 17 }],
      }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        SiteVisitReadRepositoryError
      );
    }

    const hidden = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_site_visit_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(hidden.get({ authorization })).resolves.toEqual({
      state: "not_found",
    });
  });

  it("rejects a proof-valid checklist source count when no checklist section was selected", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs", "notes"],
    });
    const raw = signedContextRaw(authorization, contextResult(), {
      artifacts: 2,
      checklist_answers: 1,
      deck_designs: 1,
      visits: 1,
    });
    const repository = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );

    await expect(repository.get({ authorization })).rejects.toThrow(
      SiteVisitReadRepositoryError
    );
  });

  it("binds proof-valid checklist inspection counts to the summary and raw answer page", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["checklist_answers", "checklist_summary"],
      checklist_answer_limit: 25,
    });
    const result = checklistContextResult();
    const exactSource = {
      artifacts: 0,
      checklist_answers: 2,
      deck_designs: 0,
      visits: 1,
    } as const;
    const exact = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([
        {
          data: signedContextRaw(authorization, result, exactSource),
          error: null,
        },
      ])
    );
    await expect(exact.get({ authorization })).resolves.toMatchObject({
      state: "found",
    });

    const mismatches = [
      signedContextRaw(authorization, result, {
        ...exactSource,
        checklist_answers: 3,
      }),
      signedContextRaw(
        authorization,
        {
          ...result,
          sections: {
            ...result.sections,
            checklist_summary: {
              total_count: 3,
              answered_count: 1,
              required_count: 1,
              required_answered_count: 1,
              completion: "incomplete",
            },
          },
        },
        exactSource
      ),
      signedContextRaw(
        authorization,
        {
          ...result,
          sections: {
            ...result.sections,
            checklist_answers: {
              ...result.sections.checklist_answers!,
              source_count: 1,
              returned_count: 1,
              answers: result.sections.checklist_answers!.answers.slice(0, 1),
            },
          },
        },
        exactSource
      ),
    ];
    for (const raw of mismatches) {
      const repository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        SiteVisitReadRepositoryError
      );
    }
  });

  it("maps only Task 10's exact raw artifact sentinel to a bounded context state", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs", "notes"],
    });
    const bounded = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "54000",
            message: "agent_artifact_source_query_bound",
          },
        },
      ])
    );
    await expect(bounded.get({ authorization })).resolves.toEqual({
      state: "source_bound",
    });

    for (const error of [
      { code: "54000", message: "agent_artifact_source_query_bound_extra" },
      { code: "54001", message: "agent_artifact_source_query_bound" },
    ]) {
      const repository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        SiteVisitReadRepositoryError
      );
    }
  });

  it("honors cancellation without returning late data", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: { kind: "opportunity", id: SITE_VISIT_OPPORTUNITY_ID },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["artifact_summary", "deck_design_refs", "notes"],
    });
    const controller = new AbortController();
    controller.abort();
    const repository = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([{ data: contextRaw(authorization), error: null }])
    );
    await expect(
      repository.get({ authorization, signal: controller.signal })
    ).rejects.toThrow(SiteVisitReadRepositoryError);
  });
});
