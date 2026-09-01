import { describe, expect, it } from "vitest";

import { measureP2SerializedCharacters } from "../../shared/result-budget";
import { createArtifactListCursorService } from "../artifact-cursor";
import { createSupabaseArtifactReadRepository } from "../artifact-repository";
import {
  ArtifactReadError,
  getJobArtifactEvidence,
  listJobArtifacts,
} from "../artifact-reads";
import {
  ARTIFACT_ACTOR_ID,
  ARTIFACT_CLIENT_ID,
  ARTIFACT_COMPANY_ID,
  ARTIFACT_EVIDENCE_REF,
  ARTIFACT_GRANT_ID,
  ARTIFACT_OCCURRED_AT,
  ARTIFACT_PERMISSION_REVISION,
  ARTIFACT_READ_AT,
  ARTIFACT_SOURCE_ID,
  ARTIFACT_SOURCE_REVISIONS,
  artifactMetadata,
  exactArtifactAuthorization,
  listArtifactsAuthorization,
} from "./artifact-fixtures";
import {
  artifactEvidenceRef,
  artifactExactEntityProofRef,
  artifactExactProofContext,
  artifactListCollectionProofRef,
  artifactListEntityProofRef,
  artifactListProofContext,
} from "../artifact-proof";

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected artifact RPC");
    return Promise.resolve(next);
  }
}

type ListAuthorization = Awaited<ReturnType<typeof listArtifactsAuthorization>>;
type ExactAuthorization = Awaited<
  ReturnType<typeof exactArtifactAuthorization>
>;

function binding(authorization: ListAuthorization | ExactAuthorization) {
  return {
    company_id: ARTIFACT_COMPANY_ID,
    actor_user_id: ARTIFACT_ACTOR_ID,
    oauth_grant_id: ARTIFACT_GRANT_ID,
    oauth_client_id: ARTIFACT_CLIENT_ID,
    grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    permission_snapshot_revision: ARTIFACT_PERMISSION_REVISION,
    capability_id: authorization.capabilityId,
    capability_revision: authorization.capabilityRevision,
    capability_manifest_revision: "2026-08-22.capability-manifest.v8",
    granted_scope_ceiling: [...authorization.grantedScopeCeiling],
    required_oauth_scopes: [...authorization.requiredOAuthScopes],
    resolved_permission_scopes: {
      ...authorization.resolvedPermissionScopes,
    },
    source_kinds: [...authorization.sourceKinds],
    read_at: ARTIFACT_READ_AT,
    source_revisions: ARTIFACT_SOURCE_REVISIONS,
  } as const;
}

function listRaw(authorization: ListAuthorization) {
  const sourceInspected = 2;
  const sourceHasMore = true;
  const artifact = artifactMetadata();
  const sourceIdentity = {
    source_kind: "project_photo" as const,
    source_id: ARTIFACT_SOURCE_ID,
  };
  const context = artifactListProofContext({
    authorization,
    cursor: null,
    readAt: ARTIFACT_READ_AT,
    sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const proofRef = artifactListEntityProofRef({
    context,
    sourceIdentity,
    artifact,
  });
  return {
    ...binding(authorization),
    ranking_revision: "artifact-ranking:2026-08-22.v1",
    job_ref: authorization.query.job_ref,
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows: [
      {
        artifact,
        source_id: ARTIFACT_SOURCE_ID,
        proof_ref: proofRef,
        evidence_ref: ARTIFACT_EVIDENCE_REF,
        predecessor: {
          order: [ARTIFACT_OCCURRED_AT, "project_photo", ARTIFACT_EVIDENCE_REF],
          tie_breaker: ARTIFACT_EVIDENCE_REF,
        },
      },
    ],
    collection_proof_ref: artifactListCollectionProofRef({
      context,
      returnedCount: 1,
      hasMore: sourceHasMore,
      children: [
        {
          artifact_ref: {
            source_kind: artifact.source_kind,
            evidence_ref: ARTIFACT_EVIDENCE_REF,
          },
          proof_ref: proofRef,
          evidence_ref: ARTIFACT_EVIDENCE_REF,
        },
      ],
    }),
  };
}

function exactRaw(authorization: ExactAuthorization) {
  const artifact = artifactMetadata();
  const content = {
    kind: "binary_resource" as const,
    delivery_state: "ready_for_single_use_delivery" as const,
    mime_family: "image" as const,
    byte_size: 1_024,
  };
  const sourceIdentity = {
    source_kind: "project_photo" as const,
    source_id: ARTIFACT_SOURCE_ID,
  };
  const context = artifactExactProofContext({
    authorization,
    readAt: ARTIFACT_READ_AT,
    sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
    sourceInspected: 1,
  });
  return {
    ...binding(authorization),
    job_ref: authorization.query.job_ref,
    selected_source_kind: "project_photo",
    requested_evidence_ref: ARTIFACT_EVIDENCE_REF,
    source_inspected: 1,
    artifact,
    content,
    source_id: ARTIFACT_SOURCE_ID,
    proof_ref: artifactExactEntityProofRef({
      context,
      sourceIdentity,
      artifact,
      content,
    }),
  };
}

function budgetPressureListRaw(authorization: ListAuthorization) {
  const sourceInspected = 25;
  const sourceHasMore = false;
  const context = artifactListProofContext({
    authorization,
    cursor: null,
    readAt: ARTIFACT_READ_AT,
    sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
    sourceInspected,
    sourceHasMore,
  });
  const rows = Array.from({ length: 25 }, (_, index) => {
    const sourceId = `88888888-8888-4888-8888-${index
      .toString(16)
      .padStart(12, "0")}`;
    const sourceIdentity = {
      source_kind: "project_photo" as const,
      source_id: sourceId,
    };
    const evidenceRef = artifactEvidenceRef({
      companyId: authorization.actorContext.companyId,
      jobRef: authorization.query.job_ref,
      sourceIdentity,
    });
    const occurredAt = `2026-08-22T10:00:${String(59 - index).padStart(
      2,
      "0"
    )}.000Z`;
    const artifact = artifactMetadata({
      evidence_ref: evidenceRef,
      occurred_at: occurredAt,
      display_name: {
        text: "界".repeat(512),
        content_kind: "untrusted_business_data",
      },
      note_excerpt: {
        text: "界".repeat(1_000),
        content_kind: "untrusted_business_data",
      },
    });
    const proofRef = artifactListEntityProofRef({
      context,
      sourceIdentity,
      artifact,
    });
    return {
      artifact,
      source_id: sourceId,
      proof_ref: proofRef,
      evidence_ref: evidenceRef,
      predecessor: {
        order: [occurredAt, "project_photo", evidenceRef],
        tie_breaker: evidenceRef,
      },
    } as const;
  });
  return {
    ...binding(authorization),
    ranking_revision: "artifact-ranking:2026-08-22.v1",
    job_ref: authorization.query.job_ref,
    item_limit: authorization.query.limit,
    cursor_read_at: null,
    cursor_source_revisions: [],
    cursor_predecessor: null,
    source_inspected: sourceInspected,
    source_has_more: sourceHasMore,
    rows,
    collection_proof_ref: artifactListCollectionProofRef({
      context,
      returnedCount: rows.length,
      hasMore: sourceHasMore,
      children: rows.map((row) => ({
        artifact_ref: {
          source_kind: row.artifact.source_kind,
          evidence_ref: row.evidence_ref,
        },
        proof_ref: row.proof_ref,
        evidence_ref: row.evidence_ref,
      })),
    }),
  };
}

describe("P2 list_job_artifacts service", () => {
  it("returns frozen, proof-coupled, serializer-bounded metadata and signs only the retained predecessor", async () => {
    const authorization = await listArtifactsAuthorization({
      job_ref: { kind: "project", id: "33333333-3333-4333-8333-333333333333" },
      source_kinds: ["project_photo"],
      limit: 1,
    });
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([{ data: listRaw(authorization), error: null }])
    );
    const cursors = createArtifactListCursorService({
      keyId: "artifact-service",
      key: Buffer.alloc(32, 7),
    });
    const result = await listJobArtifacts({
      authorization,
      repository,
      cursors,
    });

    expect(result).toMatchObject({
      items: [{ evidence_ref: ARTIFACT_EVIDENCE_REF }],
      item_proofs: [{ proof_ref: listRaw(authorization).rows[0]!.proof_ref }],
      evidence: [{ evidence_ref: ARTIFACT_EVIDENCE_REF }],
      collection_proof: {
        proof_ref: listRaw(authorization).collection_proof_ref,
        returned_count: 1,
        has_more: true,
      },
    });
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects forged cursors before repository access and maps stale/source bounds", async () => {
    const authorization = await listArtifactsAuthorization({
      job_ref: { kind: "project", id: "33333333-3333-4333-8333-333333333333" },
      source_kinds: ["project_photo"],
      cursor: "ops_p2_cursor.a.a",
    });
    const client = new StubRpcClient([]);
    const repository = createSupabaseArtifactReadRepository(client);
    const cursors = createArtifactListCursorService({
      keyId: "artifact-service",
      key: Buffer.alloc(32, 8),
    });
    await expect(
      listJobArtifacts({ authorization, repository, cursors })
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(client.calls).toHaveLength(0);

    for (const [error, code] of [
      [
        { code: "40001", message: "agent_artifact_read_stale" },
        "STALE_CONTEXT",
      ],
      [
        { code: "54000", message: "agent_artifact_source_query_bound" },
        "RESULT_TOO_LARGE",
      ],
    ] as const) {
      const exactAuthorization = await listArtifactsAuthorization();
      const exactRepository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        listJobArtifacts({
          authorization: exactAuthorization,
          repository: exactRepository,
          cursors,
        })
      ).rejects.toMatchObject({ code });
    }
  });

  it("atomically reduces oversized artifacts and re-proves the exact retained children", async () => {
    const authorization = await listArtifactsAuthorization({
      job_ref: {
        kind: "project",
        id: "33333333-3333-4333-8333-333333333333",
      },
      source_kinds: ["project_photo"],
      limit: 25,
    });
    const raw = budgetPressureListRaw(authorization);
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([{ data: raw, error: null }])
    );
    const cursors = createArtifactListCursorService({
      keyId: "artifact-budget-reproof",
      key: Buffer.alloc(32, 9),
    });

    const result = await listJobArtifacts({
      authorization,
      repository,
      cursors,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(raw.rows.length);
    expect(result.collection_proof.returned_count).toBe(result.items.length);
    expect(result.collection_proof.has_more).toBe(true);
    expect(result.collection_proof.proof_ref).not.toBe(
      raw.collection_proof_ref
    );
    expect(result.collection_proof.proof_ref).toBe(
      artifactListCollectionProofRef({
        context: artifactListProofContext({
          authorization,
          cursor: null,
          readAt: ARTIFACT_READ_AT,
          sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
          sourceInspected: 25,
          sourceHasMore: false,
        }),
        returnedCount: result.items.length,
        hasMore: true,
        children: raw.rows.slice(0, result.items.length).map((row) => ({
          artifact_ref: {
            source_kind: row.artifact.source_kind,
            evidence_ref: row.evidence_ref,
          },
          proof_ref: row.proof_ref,
          evidence_ref: row.evidence_ref,
        })),
      })
    );
    expect(result.next_cursor).toMatch(/^ops_p2_cursor\./);
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
  });
});

describe("P2 get_job_artifact_evidence service", () => {
  it("returns one exact bounded source marker without exposing a binary locator", async () => {
    const authorization = await exactArtifactAuthorization();
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([{ data: exactRaw(authorization), error: null }])
    );
    const result = await getJobArtifactEvidence({
      authorization,
      repository,
    });

    expect(result).toMatchObject({
      artifact: { evidence_ref: ARTIFACT_EVIDENCE_REF },
      content: {
        kind: "binary_resource",
        delivery_state: "ready_for_single_use_delivery",
      },
      proof: { proof_ref: exactRaw(authorization).proof_ref },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /https?:|storage_path|object_key|signed_url/
    );
    expect(measureP2SerializedCharacters(result)).toBeLessThanOrEqual(60_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps hidden/nonexistent indistinguishable and contains raw repository failures", async () => {
    const authorization = await exactArtifactAuthorization();
    for (const [error, code] of [
      [
        {
          code: "P0002",
          message: "agent_artifact_not_found_or_not_visible",
        },
        "NOT_FOUND",
      ],
      [
        { code: "XX000", message: "secret private.agent_artifact_sources" },
        "TEMPORARILY_UNAVAILABLE",
      ],
    ] as const) {
      const repository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      let caught: unknown;
      try {
        await getJobArtifactEvidence({ authorization, repository });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ArtifactReadError);
      expect(caught).toMatchObject({ code });
      expect(JSON.stringify(caught)).not.toContain("agent_artifact_sources");
    }
  });
});
