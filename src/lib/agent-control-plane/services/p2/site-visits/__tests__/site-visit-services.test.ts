import { describe, expect, it } from "vitest";

import { measureP2SerializedCharacters } from "../../shared/result-budget";
import { createSiteVisitListCursorService } from "../site-visit-cursor";
import { createSupabaseSiteVisitReadRepository } from "../site-visit-repository";
import {
  getSiteVisitContext,
  listSiteVisits,
  SiteVisitReadError,
} from "../site-visit-reads";
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
  SITE_VISIT_COMPANY_ID,
  SITE_VISIT_GRANT_ID,
  SITE_VISIT_ID,
  SITE_VISIT_OAUTH_CLIENT_ID,
  SITE_VISIT_PERMISSION_REVISION,
  SITE_VISIT_READ_AT,
  SITE_VISIT_SOURCE_REVISIONS,
  siteVisitContextAuthorization,
} from "./site-visit-fixtures";

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Record<string, unknown>;
  }> = [];
  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}
  rpc(functionName: string, args: Record<string, unknown>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected RPC");
    return Promise.resolve(next);
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
  sourceRevisions = SITE_VISIT_SOURCE_REVISIONS
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

function listRaw(authorization: ListAuthorization) {
  const item = linkedBookedVisitSummary();
  const context = siteVisitListProofContext({
    authorization,
    cursor: null,
    readAt: SITE_VISIT_READ_AT,
    sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
    sourceInspected: 2,
    sourceHasMore: true,
  });
  const proofRef = siteVisitListEntityProofRef({ context, visit: item });
  const evidenceRef = siteVisitListEvidenceRef({
    context,
    siteVisitRef: item.site_visit_ref,
  });
  return {
    ...binding(authorization),
    query: siteVisitListQueryProjection(authorization),
    item_limit: 1,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: 2,
    source_has_more: true,
    rows: [
      {
        item,
        proof_ref: proofRef,
        evidence_ref: evidenceRef,
        predecessor: {
          view: "booked_appointments",
          order: [item.booking.booked_at, SITE_VISIT_ID],
          tie_breaker: SITE_VISIT_ID,
        },
      },
    ],
    collection_proof_ref: siteVisitListCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: true,
      children: [
        {
          site_visit_ref: item.site_visit_ref,
          proof_ref: proofRef,
          evidence_ref: evidenceRef,
        },
      ],
    }),
  } as const;
}

function contextRaw(
  authorization: ContextAuthorization,
  result: {
    readonly visit: ReturnType<typeof linkedBookedVisitSummary>;
    readonly sections: Readonly<Record<string, unknown>>;
  },
  sourceInspected: {
    readonly artifacts: number;
    readonly checklist_answers: number;
    readonly deck_designs: number;
    readonly visits: number;
  }
) {
  const context = siteVisitContextProofContext({
    authorization,
    readAt: SITE_VISIT_READ_AT,
    sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
    sourceInspected,
  });
  return {
    ...binding(authorization),
    anchor: authorization.query.anchor,
    opportunity_ref:
      authorization.query.anchor === "opportunity"
        ? authorization.query.opportunity_ref
        : null,
    site_visit_ref: authorization.query.site_visit_ref,
    selected_sections: authorization.query.sections,
    checklist_answer_limit: authorization.query.checklist_answer_limit ?? null,
    timeline_limit: authorization.query.timeline_limit ?? null,
    source_inspected: sourceInspected,
    result,
    proof_ref: siteVisitContextEntityProofRef({
      context,
      result: result as never,
    }),
    evidence_ref: siteVisitContextEvidenceRef({ context }),
  } as const;
}

describe("P2 list_site_visits service", () => {
  it("returns frozen, proof-coupled, serializer-bounded visits and signs the exact retained predecessor", async () => {
    const authorization = await listSiteVisitsAuthorization({
      view: "booked_appointments",
      from: "2026-08-20T00:00:00.000Z",
      to: "2026-08-30T00:00:00.000Z",
      limit: 1,
    });
    const raw = listRaw(authorization);
    const repository = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const cursors = createSiteVisitListCursorService({
      keyId: "site-visit-service",
      key: Buffer.alloc(32, 7),
    });
    const result = await listSiteVisits({
      authorization,
      repository,
      cursors,
    });

    expect(result).toMatchObject({
      view: "booked_appointments",
      items: [{ site_visit_ref: { id: SITE_VISIT_ID } }],
      item_proofs: [{ proof_ref: raw.rows[0]!.proof_ref }],
      evidence: [{ evidence_ref: raw.rows[0]!.evidence_ref }],
      collection_proof: {
        proof_ref: raw.collection_proof_ref,
        returned_count: 1,
        has_more: true,
      },
    });
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a forged cursor before repository access and maps stale/source bounds to fixed errors", async () => {
    const authorization = await listSiteVisitsAuthorization({
      view: "booked_appointments",
      from: "2026-08-20T00:00:00.000Z",
      to: "2026-08-30T00:00:00.000Z",
      cursor: "forged.cursor.value",
    });
    const client = new StubRpcClient([]);
    const repository = createSupabaseSiteVisitReadRepository(client);
    const cursors = createSiteVisitListCursorService({
      keyId: "site-visit-service",
      key: Buffer.alloc(32, 8),
    });
    await expect(
      listSiteVisits({ authorization, repository, cursors })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(client.calls).toHaveLength(0);

    for (const [error, code] of [
      [
        { code: "40001", message: "agent_site_visit_read_stale" },
        "STALE_CONTEXT",
      ],
      [
        { code: "54000", message: "agent_site_visit_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
    ] as const) {
      const exactAuthorization = await listSiteVisitsAuthorization();
      const exactRepository = createSupabaseSiteVisitReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        listSiteVisits({
          authorization: exactAuthorization,
          repository: exactRepository,
          cursors,
        })
      ).rejects.toMatchObject({ code });
    }
  });
});

describe("P2 get_site_visit_context service", () => {
  it("returns one exact frozen context within the serializer budget", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: {
        kind: "opportunity",
        id: "44444444-4444-4444-8444-444444444444",
      },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["notes"],
    });
    const resultPayload = {
      visit: linkedBookedVisitSummary(),
      sections: {
        notes: {
          state: "recorded",
          text: "Use glass on the back deck.",
          truncated: false,
          content_kind: "untrusted_business_data",
        },
      },
    } as const;
    const raw = contextRaw(authorization, resultPayload, {
      artifacts: 0,
      checklist_answers: 0,
      deck_designs: 0,
      visits: 1,
    });
    const repository = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const result = await getSiteVisitContext({ authorization, repository });

    expect(result.sections).toEqual(resultPayload.sections);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("reduces only checklist answer units, updates counts, and re-proves the retained exact result", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: {
        kind: "opportunity",
        id: "44444444-4444-4444-8444-444444444444",
      },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["checklist_answers"],
    });
    const answers = Array.from({ length: 25 }, (_, index) => ({
      field_ref: `ops_site_visit_field:v1:${String(index + 1).padStart(64, "0")}`,
      label: `${String(index + 1).padStart(2, "0")}-${"L".repeat(470)}`,
      kind: "long_text" as const,
      required: false,
      answer: {
        state: "recorded" as const,
        value_kind: "text" as const,
        text: `${String(index + 1).padStart(2, "0")}-${"T".repeat(1_970)}`,
        truncated: false,
        content_kind: "untrusted_business_data" as const,
      },
      content_kind: "untrusted_business_data" as const,
    }));
    const payload = {
      visit: linkedBookedVisitSummary(),
      sections: {
        checklist_answers: {
          source_count: 25,
          source_has_more: false,
          returned_count: 25,
          result_budget_omitted_count: 0,
          answers,
        },
      },
    } as const;
    const sourceInspected = {
      artifacts: 0,
      checklist_answers: 25,
      deck_designs: 0,
      visits: 1,
    } as const;
    const raw = contextRaw(authorization, payload, sourceInspected);
    const repository = createSupabaseSiteVisitReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );

    const result = await getSiteVisitContext({ authorization, repository });
    const retained = result.sections.checklist_answers!;
    expect(retained.answers.length).toBeGreaterThan(0);
    expect(retained.answers.length).toBeLessThan(25);
    expect(retained.returned_count).toBe(retained.answers.length);
    expect(retained.result_budget_omitted_count).toBe(
      25 - retained.answers.length
    );
    expect(result.proof.proof_ref).not.toBe(raw.proof_ref);
    const context = siteVisitContextProofContext({
      authorization,
      readAt: SITE_VISIT_READ_AT,
      sourceRevisions: SITE_VISIT_SOURCE_REVISIONS,
      sourceInspected,
    });
    expect(result.proof.proof_ref).toBe(
      siteVisitContextEntityProofRef({
        context,
        result: { visit: result.visit, sections: result.sections },
      })
    );
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
  });

  it("authorizes every requested component before repository access and keeps hidden/nonexistent indistinguishable", async () => {
    const authorization = await siteVisitContextAuthorization({
      anchor: "opportunity",
      opportunity_ref: {
        kind: "opportunity",
        id: "44444444-4444-4444-8444-444444444444",
      },
      site_visit_ref: { kind: "site_visit", id: SITE_VISIT_ID },
      sections: ["notes"],
    });
    const untouched = new StubRpcClient([]);
    const untouchedRepository =
      createSupabaseSiteVisitReadRepository(untouched);
    await expect(
      getSiteVisitContext({
        authorization: { ...authorization } as never,
        repository: untouchedRepository,
      })
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(untouched.calls).toHaveLength(0);

    const hiddenRepository = createSupabaseSiteVisitReadRepository(
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
    let caught: unknown;
    try {
      await getSiteVisitContext({
        authorization,
        repository: hiddenRepository,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SiteVisitReadError);
    expect(caught).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(caught)).not.toContain("site_visits");
  });
});
