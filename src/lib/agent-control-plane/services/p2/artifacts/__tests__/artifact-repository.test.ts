import { describe, expect, it } from "vitest";

import {
  ArtifactReadRepositoryError,
  createSupabaseArtifactReadRepository,
} from "../artifact-repository";
import {
  ARTIFACT_ACTOR_ID,
  ARTIFACT_CLIENT_ID,
  ARTIFACT_COMPANY_ID,
  ARTIFACT_EVIDENCE_REF,
  ARTIFACT_GRANT_ID,
  ARTIFACT_OCCURRED_AT,
  ARTIFACT_PERMISSION_REVISION,
  ARTIFACT_PROOF_REF,
  ARTIFACT_READ_AT,
  ARTIFACT_SOURCE_ID,
  ARTIFACT_SOURCE_REVISIONS,
  artifactMetadata,
  exactArtifactAuthorization,
  listArtifactsAuthorization,
} from "./artifact-fixtures";
import {
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
  readonly abortSignals: AbortSignal[] = [];

  constructor(
    private readonly results: Array<Readonly<{ data: unknown; error: unknown }>>
  ) {}

  rpc(functionName: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ functionName, args });
    const next = this.results.shift();
    if (!next) throw new Error("Unexpected artifact RPC");
    const request = Promise.resolve(next);
    return Object.assign(request, {
      abortSignal: (signal: AbortSignal) => {
        this.abortSignals.push(signal);
        return request;
      },
    });
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

function predecessor() {
  return {
    order: [
      ARTIFACT_OCCURRED_AT,
      "project_photo",
      ARTIFACT_EVIDENCE_REF,
    ] as const,
    tie_breaker: ARTIFACT_EVIDENCE_REF,
  };
}

function listRaw(
  authorization: ListAuthorization,
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const sourceInspected = 1;
  const sourceHasMore = false;
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
  const row = {
    artifact,
    source_id: ARTIFACT_SOURCE_ID,
    proof_ref: proofRef,
    evidence_ref: ARTIFACT_EVIDENCE_REF,
    predecessor: predecessor(),
  };
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
    rows: [row],
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
    ...overrides,
  };
}

function exactRaw(
  authorization: ExactAuthorization,
  overrides: Readonly<Record<string, unknown>> = {}
) {
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
    ...overrides,
  };
}

describe("P2 artifact list repository", () => {
  it("calls only the fixed metadata RPC with exact actor/grant/policy/job/source and 25/26/501 bounds", async () => {
    const authorization = await listArtifactsAuthorization();
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseArtifactReadRepository(client);
    const result = await repository.list({ authorization, cursor: null });

    expect(result).toMatchObject({
      state: "found",
      page: {
        readAt: ARTIFACT_READ_AT,
        sourceRevisions: ARTIFACT_SOURCE_REVISIONS,
        sourceHasMore: false,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({
      functionName: "read_agent_job_artifacts_as_system",
      args: expect.objectContaining({
        p_actor_user_id: ARTIFACT_ACTOR_ID,
        p_company_id: ARTIFACT_COMPANY_ID,
        p_oauth_grant_id: ARTIFACT_GRANT_ID,
        p_oauth_client_id: ARTIFACT_CLIENT_ID,
        p_grant_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        p_permission_snapshot_revision: ARTIFACT_PERMISSION_REVISION,
        p_capability_id: "list_job_artifacts",
        p_job_kind: "project",
        p_job_id: "33333333-3333-4333-8333-333333333333",
        p_source_kinds: ["project_photo"],
        p_resolved_permission_scopes: {
          "photos.view": "assigned",
          "projects.view": "assigned",
        },
        p_item_limit: 25,
        p_page_fetch_limit: 26,
        p_source_limit: 501,
        p_cursor_read_at: null,
        p_after_evidence_ref: null,
      }),
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects binding, source, ordering, proof, privacy, physical-bound, and cursor tampering", async () => {
    const authorization = await listArtifactsAuthorization();
    const invalid = [
      listRaw(authorization, {
        actor_user_id: "99999999-9999-4999-8999-999999999999",
      }),
      listRaw(authorization, { source_inspected: 501 }),
      listRaw(authorization, { source_kinds: ["project_note"] }),
      listRaw(authorization, {
        source_revisions: [{ domain: "artifacts", source_revision: 17 }],
      }),
      listRaw(authorization, {
        rows: [listRaw(authorization).rows[0], listRaw(authorization).rows[0]],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...listRaw(authorization).rows[0],
            artifact: {
              ...artifactMetadata(),
              storage_path: "company/private/photo.jpg",
            },
          },
        ],
      }),
      listRaw(authorization, { cursor_read_at: ARTIFACT_READ_AT }),
    ];

    for (const raw of invalid) {
      const repository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(ArtifactReadRepositoryError);
    }
  });

  it("rejects valid-shaped artifact, evidence, and collection proof tampering", async () => {
    const authorization = await listArtifactsAuthorization();
    const replacementEvidenceRef = `ops_evidence:v1:${"f".repeat(64)}`;
    const raw = listRaw(authorization);
    const invalid = [
      listRaw(authorization, {
        rows: [
          {
            ...raw.rows[0],
            artifact: artifactMetadata({
              display_name: {
                text: "Forged rear elevation",
                content_kind: "untrusted_business_data",
              },
            }),
          },
        ],
      }),
      listRaw(authorization, {
        rows: [
          {
            ...raw.rows[0],
            artifact: artifactMetadata({
              evidence_ref: replacementEvidenceRef,
            }),
            evidence_ref: replacementEvidenceRef,
            predecessor: {
              order: [
                ARTIFACT_OCCURRED_AT,
                "project_photo",
                replacementEvidenceRef,
              ],
              tie_breaker: replacementEvidenceRef,
            },
          },
        ],
      }),
      listRaw(authorization, { collection_proof_ref: ARTIFACT_PROOF_REF }),
    ];

    for (const candidate of invalid) {
      const repository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: candidate, error: null }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).rejects.toThrow(ArtifactReadRepositoryError);
    }
  });

  it("maps only exact source-bound and stale failures to privacy-safe states", async () => {
    const authorization = await listArtifactsAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_artifact_source_query_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_artifact_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(
        repository.list({ authorization, cursor: null })
      ).resolves.toEqual({ state });
    }
  });

  it("rejects an incomplete cursor revision vector before making an RPC", async () => {
    const authorization = await listArtifactsAuthorization();
    const client = new StubRpcClient([
      { data: listRaw(authorization), error: null },
    ]);
    const repository = createSupabaseArtifactReadRepository(client);
    await expect(
      repository.list({
        authorization,
        cursor: {
          readAt: ARTIFACT_READ_AT,
          sourceRevisions: [{ domain: "artifacts", source_revision: 17 }],
          predecessor: predecessor(),
        },
      })
    ).rejects.toThrow(ArtifactReadRepositoryError);
    expect(client.calls).toHaveLength(0);
  });
});

describe("P2 exact artifact evidence-source repository", () => {
  it("calls only the fixed exact-source RPC and never returns a locator for binary evidence", async () => {
    const authorization = await exactArtifactAuthorization();
    const client = new StubRpcClient([
      { data: exactRaw(authorization), error: null },
    ]);
    const repository = createSupabaseArtifactReadRepository(client);
    const result = await repository.get({ authorization });

    expect(client.calls[0]).toEqual({
      functionName: "read_agent_job_artifact_evidence_as_system",
      args: expect.objectContaining({
        p_job_kind: "project",
        p_job_id: "33333333-3333-4333-8333-333333333333",
        p_source_kind: "project_photo",
        p_evidence_ref: ARTIFACT_EVIDENCE_REF,
        p_source_limit: 501,
      }),
    });
    expect(result).toMatchObject({
      state: "found",
      value: {
        artifact: { evidence_ref: ARTIFACT_EVIDENCE_REF },
        content: { kind: "binary_resource" },
        evidence: [{ evidence_ref: ARTIFACT_EVIDENCE_REF }],
        proof: { proof_ref: exactRaw(authorization).proof_ref },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /https?:|storage_path|object_key|signed_url/
    );
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects source/evidence drift, unsafe binary state, private locators, and the 501st physical row", async () => {
    const authorization = await exactArtifactAuthorization();
    const invalid = [
      exactRaw(authorization, { selected_source_kind: "project_note" }),
      exactRaw(authorization, {
        requested_evidence_ref: `ops_evidence:v1:${"f".repeat(64)}`,
      }),
      exactRaw(authorization, {
        artifact: artifactMetadata({ inspection_state: "pending" }),
      }),
      exactRaw(authorization, {
        content: {
          ...exactRaw(authorization).content,
          storage_path: "company/private/photo.jpg",
        },
      }),
      exactRaw(authorization, { source_inspected: 501 }),
    ];
    for (const raw of invalid) {
      const repository = createSupabaseArtifactReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        ArtifactReadRepositoryError
      );
    }
  });

  it("rejects valid-shaped exact evidence projection tampering", async () => {
    const authorization = await exactArtifactAuthorization();
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([
        {
          data: exactRaw(authorization, {
            content: {
              kind: "unavailable",
              code: "SOURCE_UNAVAILABLE",
            },
          }),
          error: null,
        },
      ])
    );

    await expect(repository.get({ authorization })).rejects.toThrow(
      ArtifactReadRepositoryError
    );
  });

  it("keeps hidden, deleted, stale, and nonexistent evidence indistinguishable", async () => {
    const authorization = await exactArtifactAuthorization();
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_artifact_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(repository.get({ authorization })).resolves.toEqual({
      state: "not_found",
    });
  });

  it("honors cancellation without returning late source data", async () => {
    const authorization = await exactArtifactAuthorization();
    const controller = new AbortController();
    controller.abort();
    const repository = createSupabaseArtifactReadRepository(
      new StubRpcClient([{ data: exactRaw(authorization), error: null }])
    );
    await expect(
      repository.get({ authorization, signal: controller.signal })
    ).rejects.toThrow(ArtifactReadRepositoryError);
  });
});
