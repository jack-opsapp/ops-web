import { describe, expect, it, vi } from "vitest";

import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CrewCalloutRecoveryRepositoryAmbiguityError,
  CrewCalloutRecoveryRepositoryAuthorityError,
  CrewCalloutRecoveryRepositoryBoundError,
  CrewCalloutRecoveryRepositoryInputError,
  CrewCalloutRecoveryRepositoryStaleError,
  CrewCalloutRecoveryRepositoryUnavailableError,
  createCrewCalloutRecoveryRepository,
  type CrewCalloutRecoveryRpcClient,
} from "../crew-callout-recovery-repository";
import {
  ACTOR_USER_ID,
  COMPANY_ID,
  CREW_CALLOUT_RECOVERY_INPUT,
  CREW_CALLOUT_RECOVERY_SCOPES,
  OAUTH_CLIENT_ID,
  OAUTH_GRANT_ID,
  crewCalloutRecoveryActorFixture,
  crewCalloutRecoverySourceFixture,
} from "./fixtures";

describe("crew call-out recovery repository", () => {
  it("makes one abortable bounded read with the exact v18/v12 binding", async () => {
    const { actor } = await crewCalloutRecoveryActorFixture();
    const source = crewCalloutRecoverySourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<CrewCalloutRecoveryRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );

    await expect(
      createCrewCalloutRecoveryRepository({ rpc }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        input: CREW_CALLOUT_RECOVERY_INPUT,
        signal,
      })
    ).resolves.toEqual(source);

    expect(rpc).toHaveBeenCalledWith(
      "read_agent_crew_callout_recovery_as_system",
      {
        p_actor_user_id: ACTOR_USER_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: OAUTH_GRANT_ID,
        p_oauth_client_id: OAUTH_CLIENT_ID,
        p_grant_revision: "f".repeat(32),
        p_granted_scope_ceiling: CREW_CALLOUT_RECOVERY_SCOPES,
        p_permission_snapshot_revision: `sha256:${"e".repeat(64)}`,
        p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
        p_capability_manifest_revision: "2026-09-03.capability-manifest.v18",
        p_exposure_revision: "2026-09-03.mcp-exposure.v12",
        p_capability_id: "prepare_crew_callout_recovery",
        p_capability_revision: "prepare_crew_callout_recovery:2026-09-03.v1",
        p_observed_at: source.observed_at,
        p_crew_member_name: CREW_CALLOUT_RECOVERY_INPUT.crew_member_name,
        p_target_date: CREW_CALLOUT_RECOVERY_INPUT.target_date,
        p_item_limit: 26,
        p_candidate_limit: 251,
        p_schedule_source_limit: 501,
      }
    );
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("normalizes exact ambiguity, authority, input, stale, bound, and storage errors", async () => {
    const { actor } = await crewCalloutRecoveryActorFixture();
    const source = crewCalloutRecoverySourceFixture();
    const cases = [
      [
        { code: "P0002", message: "AGENT_CREW_CALLOUT_IDENTITY_AMBIGUOUS" },
        CrewCalloutRecoveryRepositoryAmbiguityError,
      ],
      [
        { code: "42501", message: "denied" },
        CrewCalloutRecoveryRepositoryAuthorityError,
      ],
      [
        { code: "22023", message: "AGENT_CREW_CALLOUT_INPUT_INVALID" },
        CrewCalloutRecoveryRepositoryInputError,
      ],
      [
        { code: "55000", message: "AGENT_CREW_CALLOUT_SOURCE_STALE" },
        CrewCalloutRecoveryRepositoryStaleError,
      ],
      [
        { code: "54000", message: "AGENT_CREW_CALLOUT_SOURCE_BOUND" },
        CrewCalloutRecoveryRepositoryBoundError,
      ],
      [
        { code: "XX000", message: "storage" },
        CrewCalloutRecoveryRepositoryUnavailableError,
      ],
    ] as const;
    for (const [error, ErrorType] of cases) {
      await expect(
        createCrewCalloutRecoveryRepository({
          rpc: () => Promise.resolve({ data: null, error }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          input: CREW_CALLOUT_RECOVERY_INPUT,
        })
      ).rejects.toBeInstanceOf(ErrorType);
    }
  });

  it("deep-freezes accepted data and independently replays final authority", async () => {
    const { actor } = await crewCalloutRecoveryActorFixture();
    const source = crewCalloutRecoverySourceFixture();
    const rpc = vi.fn<CrewCalloutRecoveryRpcClient["rpc"]>((functionName) =>
      Promise.resolve(
        functionName === "read_agent_crew_callout_recovery_as_system"
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
    const repository = createCrewCalloutRecoveryRepository({ rpc });
    const accepted = await repository.readSourceSnapshot({
      actorContext: actor,
      observedAt: source.observed_at,
      input: CREW_CALLOUT_RECOVERY_INPUT,
    });
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.affected_items[0])).toBe(true);
    expect(Object.isFrozen(accepted.candidates[0]?.availability_days[0])).toBe(
      true
    );

    await expect(
      repository.assertCurrentAuthority({
        actorContext: actor,
        observedAt: source.observed_at,
        input: CREW_CALLOUT_RECOVERY_INPUT,
        expectedSourceRevision: source.source_revision,
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith(
      "assert_agent_crew_callout_recovery_authority_as_system",
      expect.objectContaining({
        p_crew_member_name: CREW_CALLOUT_RECOVERY_INPUT.crew_member_name,
        p_target_date: CREW_CALLOUT_RECOVERY_INPUT.target_date,
        p_expected_source_revision: source.source_revision,
      })
    );
  });
});
