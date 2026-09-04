import { describe, expect, it, vi } from "vitest";

import {
  createEstimateDraftRepository,
  EstimateDraftRepositoryAuthorityError,
  EstimateDraftRepositoryBoundError,
  EstimateDraftRepositoryInputError,
  EstimateDraftRepositoryStaleError,
  EstimateDraftRepositoryUnavailableError,
  type EstimateDraftRpcClient,
} from "../estimate-draft-repository";
import {
  ACTOR_USER_ID,
  COMPANY_ID,
  INPUT,
  OAUTH_CLIENT_ID,
  OAUTH_GRANT_ID,
  ESTIMATE_DRAFT_SCOPES,
  estimateDraftActorFixture,
  estimateDraftSourceFixture,
} from "./fixtures";

describe("estimate draft repository", () => {
  it("makes one abortable bounded read with the exact v16/v10 binding", async () => {
    const { actor } = await estimateDraftActorFixture();
    const source = estimateDraftSourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<EstimateDraftRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );

    await expect(
      createEstimateDraftRepository({ rpc }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        input: INPUT,
        signal,
      })
    ).resolves.toEqual(source);

    expect(rpc).toHaveBeenCalledWith("read_agent_estimate_draft_as_system", {
      p_actor_user_id: ACTOR_USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: OAUTH_GRANT_ID,
      p_oauth_client_id: OAUTH_CLIENT_ID,
      p_grant_revision: "b".repeat(32),
      p_granted_scope_ceiling: ESTIMATE_DRAFT_SCOPES,
      p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
      p_capability_manifest_revision: "2026-09-02.capability-manifest.v16",
      p_exposure_revision: "2026-09-02.mcp-exposure.v10",
      p_capability_id: "prepare_estimate_from_past_job",
      p_capability_revision: "prepare_estimate_from_past_job:2026-09-02.v1",
      p_observed_at: source.observed_at,
      p_target_opportunity_id: INPUT.target_opportunity_id,
      p_source_estimate_id: INPUT.source_estimate_id,
      p_line_item_limit: 101,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("rejects wrong bindings, malformed envelopes, identity drift, and oversized snapshots", async () => {
    const { actor } = await estimateDraftActorFixture();
    const source = estimateDraftSourceFixture();
    const repository = createEstimateDraftRepository({
      rpc: () => Promise.resolve({ data: source, error: null }),
    });
    await expect(
      repository.readSourceSnapshot({
        actorContext: { ...actor, capabilityManifestRevision: "wrong" },
        observedAt: source.observed_at,
        input: INPUT,
      })
    ).rejects.toThrow("Estimate draft requires a v16 MCP actor");

    for (const data of [
      null,
      { ...source, observed_at: "2026-09-02T19:00:01.000Z" },
      { ...source, source_revision: "invalid" },
      {
        ...source,
        context: { ...source.context, company_id: OAUTH_CLIENT_ID },
      },
      {
        ...source,
        target: { ...source.target, opportunity_id: OAUTH_CLIENT_ID },
      },
      { ...source, source: { ...source.source, estimate_id: OAUTH_CLIENT_ID } },
      {
        ...source,
        context: { ...source.context, company_name: "x".repeat(1_000_001) },
      },
    ]) {
      await expect(
        createEstimateDraftRepository({
          rpc: () => Promise.resolve({ data, error: null }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          input: INPUT,
        })
      ).rejects.toBeInstanceOf(EstimateDraftRepositoryUnavailableError);
    }
  });

  it("normalizes authority, input, stale, bound, and storage failures", async () => {
    const { actor } = await estimateDraftActorFixture();
    const source = estimateDraftSourceFixture();
    const cases = [
      [
        { code: "42501", message: "denied" },
        EstimateDraftRepositoryAuthorityError,
      ],
      [
        { code: "22023", message: "AGENT_ESTIMATE_DRAFT_INPUT_INVALID" },
        EstimateDraftRepositoryInputError,
      ],
      [
        { code: "55000", message: "AGENT_ESTIMATE_DRAFT_SOURCE_STALE" },
        EstimateDraftRepositoryStaleError,
      ],
      [
        { code: "54000", message: "AGENT_ESTIMATE_DRAFT_SOURCE_BOUND" },
        EstimateDraftRepositoryBoundError,
      ],
      [
        { code: "XX000", message: "storage" },
        EstimateDraftRepositoryUnavailableError,
      ],
    ] as const;
    for (const [error, ErrorType] of cases) {
      await expect(
        createEstimateDraftRepository({
          rpc: () => Promise.resolve({ data: null, error }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          input: INPUT,
        })
      ).rejects.toBeInstanceOf(ErrorType);
    }
  });

  it("deep-freezes accepted data and independently binds final authority to the source revision", async () => {
    const { actor } = await estimateDraftActorFixture();
    const source = estimateDraftSourceFixture();
    const rpc = vi.fn<EstimateDraftRpcClient["rpc"]>((functionName) =>
      Promise.resolve(
        functionName === "read_agent_estimate_draft_as_system"
          ? { data: source, error: null }
          : {
              data: {
                permission_snapshot_revision: actor.permissionSnapshotRevision,
                source_revision: source.source_revision,
              },
              error: null,
            }
      )
    );
    const repository = createEstimateDraftRepository({ rpc });
    const accepted = await repository.readSourceSnapshot({
      actorContext: actor,
      observedAt: source.observed_at,
      input: INPUT,
    });
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.line_items)).toBe(true);
    expect(Object.isFrozen(accepted.line_items[0])).toBe(true);

    await expect(
      repository.assertCurrentAuthority({
        actorContext: actor,
        input: INPUT,
        expectedSourceRevision: source.source_revision,
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith(
      "assert_agent_estimate_draft_authority_as_system",
      expect.objectContaining({
        p_target_opportunity_id: INPUT.target_opportunity_id,
        p_source_estimate_id: INPUT.source_estimate_id,
        p_expected_source_revision: source.source_revision,
      })
    );
  });
});
