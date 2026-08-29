import { describe, expect, it } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import { DECK_GEOMETRY_MAX_SOURCE_BYTES } from "@/lib/agent-control-plane/contracts/deck-design-geometry";
import {
  DeckGeometryReadRepositoryError,
  createSupabaseDeckGeometryReadRepository,
} from "../deck-geometry-repository";
import { deckGeometryDrawingContentHash } from "../deck-geometry-proof";
import {
  DECK_GEOMETRY_DECK_REF,
  DECK_GEOMETRY_DESIGN_ID,
  DECK_GEOMETRY_DRAWING_SOURCE,
  DECK_GEOMETRY_JOB_ID,
  DECK_GEOMETRY_SITE_VISIT_ID,
  deckGeometryAuthorization,
  deckGeometryRawSnapshot,
} from "./deck-geometry-service-fixtures";

interface StubResponse {
  readonly data: unknown;
  readonly error: unknown;
}

class StubRpcClient {
  readonly calls: Array<{
    functionName: string;
    args: Readonly<Record<string, unknown>>;
  }> = [];
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
    request.abortSignal = (signal) =>
      signal.aborted
        ? Promise.reject(new DOMException("Aborted", "AbortError"))
        : request;
    return request;
  }
}

describe("P2 deck-geometry source repository", () => {
  it("calls only the fixed service-role RPC and preserves drawing data privately", async () => {
    const authorization = await deckGeometryAuthorization();
    const client = new StubRpcClient([
      { data: deckGeometryRawSnapshot(authorization), error: null },
    ]);
    const repository = createSupabaseDeckGeometryReadRepository(client);
    const result = await repository.get({ authorization });

    expect(client.calls).toEqual([
      {
        functionName: "read_agent_deck_design_geometry_as_system",
        args: {
          p_request_id: authorization.actorContext.requestId,
          p_company_id: authorization.actorContext.companyId,
          p_actor_user_id: authorization.actorContext.actorUserId,
          p_oauth_grant_id: authorization.oauthGrantId,
          p_oauth_client_id: authorization.oauthClientId,
          p_grant_revision: authorization.grantRevision,
          p_granted_scope_ceiling: authorization.grantedScopeCeiling,
          p_permission_snapshot_revision:
            authorization.actorContext.permissionSnapshotRevision,
          p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
          p_capability_manifest_revision:
            authorization.capabilityManifestRevision,
          p_capability_id: authorization.capabilityId,
          p_capability_revision: authorization.capabilityRevision,
          p_authorization_candidates: authorization.authorizationCandidates.map(
            (candidate) => ({
              variant_key: candidate.variantKey,
              required_oauth_scopes: candidate.requiredOAuthScopes,
              resolved_permission_scopes: candidate.resolvedPermissionScopes,
              satisfied_permission_group_indexes:
                candidate.satisfiedPermissionGroupIndexes,
            })
          ),
          p_source: "job_artifact",
          p_job_kind: "project",
          p_job_id: DECK_GEOMETRY_JOB_ID,
          p_site_visit_id: null,
          p_deck_design_ref: DECK_GEOMETRY_DECK_REF,
          p_source_limit: 501,
        },
      },
    ]);
    expect(result).toMatchObject({
      state: "found",
      snapshot: {
        designId: DECK_GEOMETRY_DESIGN_ID,
        drawingSource: DECK_GEOMETRY_DRAWING_SOURCE,
        titleText: "Rear deck",
        authorityPath: "job_project",
        designParents: {
          opportunityId: null,
          projectId: DECK_GEOMETRY_JOB_ID,
        },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("binds a site source to the exact visit selector and active bridge path", async () => {
    const authorization = await deckGeometryAuthorization({
      source: "site_visit_artifact",
      site_visit_ref: {
        kind: "site_visit",
        id: DECK_GEOMETRY_SITE_VISIT_ID,
      },
      deck_design_ref: DECK_GEOMETRY_DECK_REF,
    });
    const client = new StubRpcClient([
      { data: deckGeometryRawSnapshot(authorization), error: null },
    ]);
    const repository = createSupabaseDeckGeometryReadRepository(client);

    await expect(repository.get({ authorization })).resolves.toMatchObject({
      state: "found",
      snapshot: {
        authorityPath: "site_visit_linked",
        visitOpportunityId: DECK_GEOMETRY_JOB_ID,
      },
    });
    expect(client.calls[0]?.args).toMatchObject({
      p_source: "site_visit_artifact",
      p_job_kind: null,
      p_job_id: null,
      p_site_visit_id: DECK_GEOMETRY_SITE_VISIT_ID,
      p_deck_design_ref: DECK_GEOMETRY_DECK_REF,
    });
  });

  it("selects the minimal unlinked policy without customer or schedule consent", async () => {
    const authorization = await deckGeometryAuthorization(
      {
        source: "site_visit_artifact",
        site_visit_ref: {
          kind: "site_visit",
          id: DECK_GEOMETRY_SITE_VISIT_ID,
        },
        deck_design_ref: DECK_GEOMETRY_DECK_REF,
      },
      {
        "calendar.view": null,
        "clients.view": null,
        "deck_builder.view": "all",
        "pipeline.view": "all",
        "projects.view": null,
      },
      ["ops.files.read", "ops.jobs.read", "ops.site_visits.read"]
    );
    expect(authorization.variantKeys).toEqual(["site_visit_artifact_unlinked"]);
    const raw = deckGeometryRawSnapshot(authorization, {
      authority_path: "site_visit_unlinked",
      visit_opportunity_id: null,
      design_parents: { opportunity_id: null, project_id: null },
      source_inspected: {
        artifact_bridges: 1,
        deck_designs: 1,
        jobs: 0,
        site_visits: 1,
        visit_opportunities: 0,
      },
    });
    const client = new StubRpcClient([{ data: raw, error: null }]);

    await expect(
      createSupabaseDeckGeometryReadRepository(client).get({ authorization })
    ).resolves.toMatchObject({
      state: "found",
      snapshot: {
        authorityPath: "site_visit_unlinked",
        selectedAuthorization: {
          variantKey: "site_visit_artifact_unlinked",
          requiredOAuthScopes: [
            "ops.files.read",
            "ops.jobs.read",
            "ops.site_visits.read",
          ],
        },
        designParents: { opportunityId: null, projectId: null },
      },
    });
    expect(client.calls[0]?.args.p_authorization_candidates).toEqual([
      expect.objectContaining({
        variant_key: "site_visit_artifact_unlinked",
      }),
    ]);
  });

  it("proves and retains every non-null current design parent", async () => {
    const authorization = await deckGeometryAuthorization();
    const opportunityId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const client = new StubRpcClient([
      {
        data: deckGeometryRawSnapshot(authorization, {
          design_parents: {
            opportunity_id: opportunityId,
            project_id: DECK_GEOMETRY_JOB_ID,
          },
          source_inspected: {
            artifact_bridges: 0,
            deck_designs: 1,
            jobs: 2,
            site_visits: 0,
            visit_opportunities: 0,
          },
        }),
        error: null,
      },
    ]);

    await expect(
      createSupabaseDeckGeometryReadRepository(client).get({ authorization })
    ).resolves.toMatchObject({
      state: "found",
      snapshot: {
        designParents: {
          opportunityId,
          projectId: DECK_GEOMETRY_JOB_ID,
        },
      },
    });

    const assignedOnly = await deckGeometryAuthorization(undefined, {
      "calendar.view": null,
      "clients.view": null,
      "deck_builder.view": "assigned",
      "pipeline.view": null,
      "projects.view": "assigned",
    });
    const unauthorizedSecondParent = deckGeometryRawSnapshot(assignedOnly, {
      design_parents: {
        opportunity_id: opportunityId,
        project_id: DECK_GEOMETRY_JOB_ID,
      },
      source_inspected: {
        artifact_bridges: 0,
        deck_designs: 1,
        jobs: 2,
        site_visits: 0,
        visit_opportunities: 0,
      },
    });
    await expect(
      createSupabaseDeckGeometryReadRepository(
        new StubRpcClient([{ data: unauthorizedSecondParent, error: null }])
      ).get({ authorization: assignedOnly })
    ).rejects.toThrow(DeckGeometryReadRepositoryError);
  });

  it("rejects binding drift, ref/hash tampering, source overflow, and private extras", async () => {
    const authorization = await deckGeometryAuthorization();
    const oversized = "x".repeat(DECK_GEOMETRY_MAX_SOURCE_BYTES + 1);
    const invalid = [
      deckGeometryRawSnapshot(authorization, {
        actor_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      deckGeometryRawSnapshot(authorization, {
        deck_design_ref: `ops_deck_design:v1:${"f".repeat(64)}`,
      }),
      deckGeometryRawSnapshot(authorization, {
        drawing_content_hash: `sha256:${"f".repeat(64)}`,
      }),
      deckGeometryRawSnapshot(authorization, {
        source_revisions: [
          { domain: "deck_designs", source_revision: 13 },
          { domain: "artifacts", source_revision: 11 },
          { domain: "legacy_operational", source_revision: 17 },
          { domain: "site_visits", source_revision: 19 },
        ],
      }),
      deckGeometryRawSnapshot(authorization, {
        source_inspected: {
          artifact_bridges: 0,
          deck_designs: 501,
          jobs: 1,
          site_visits: 0,
          visit_opportunities: 0,
        },
      }),
      deckGeometryRawSnapshot(authorization, {
        authority_path: "job_opportunity",
      }),
      deckGeometryRawSnapshot(authorization, {
        selected_authorization_variant: "site_visit_artifact_unlinked",
      }),
      deckGeometryRawSnapshot(authorization, {
        drawing_source: oversized,
        drawing_content_hash: deckGeometryDrawingContentHash(oversized),
      }),
      {
        ...deckGeometryRawSnapshot(authorization),
        storage_path: "company/private/deck.json",
      },
    ];

    for (const raw of invalid) {
      const repository = createSupabaseDeckGeometryReadRepository(
        new StubRpcClient([{ data: raw, error: null }])
      );
      await expect(repository.get({ authorization })).rejects.toThrow(
        DeckGeometryReadRepositoryError
      );
    }
  });

  it("keeps hidden, deleted, stale-linked, and nonexistent designs indistinguishable", async () => {
    const authorization = await deckGeometryAuthorization();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient([
        {
          data: null,
          error: {
            code: "P0002",
            message: "agent_deck_geometry_not_found_or_not_visible",
          },
        },
      ])
    );
    await expect(repository.get({ authorization })).resolves.toEqual({
      state: "not_found",
    });
  });

  it("maps only exact bounded and stale failures and honors cancellation", async () => {
    const authorization = await deckGeometryAuthorization();
    for (const [error, state] of [
      [
        { code: "54000", message: "agent_deck_geometry_source_bound" },
        "source_bound",
      ],
      [{ code: "40001", message: "agent_deck_geometry_read_stale" }, "stale"],
    ] as const) {
      const repository = createSupabaseDeckGeometryReadRepository(
        new StubRpcClient([{ data: null, error }])
      );
      await expect(repository.get({ authorization })).resolves.toEqual({
        state,
      });
    }

    const controller = new AbortController();
    controller.abort();
    const repository = createSupabaseDeckGeometryReadRepository(
      new StubRpcClient([
        { data: deckGeometryRawSnapshot(authorization), error: null },
      ])
    );
    await expect(
      repository.get({ authorization, signal: controller.signal })
    ).rejects.toThrow(DeckGeometryReadRepositoryError);
  });
});
