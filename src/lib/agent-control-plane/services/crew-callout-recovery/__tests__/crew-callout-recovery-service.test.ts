import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  createCrewCalloutRecoveryRepository,
  type CrewCalloutRecoveryRpcClient,
} from "../crew-callout-recovery-repository";
import {
  CrewCalloutRecoveryPrepareError,
  createCrewCalloutRecoveryService,
} from "../crew-callout-recovery-service";
import {
  CREW_CALLOUT_RECOVERY_INPUT,
  crewCalloutRecoveryActorFixture,
  crewCalloutRecoverySourceFixture,
} from "./fixtures";

function successfulRpc(source = crewCalloutRecoverySourceFixture()) {
  return vi.fn<CrewCalloutRecoveryRpcClient["rpc"]>((functionName) =>
    Promise.resolve(
      functionName === "read_agent_crew_callout_recovery_as_system"
        ? { data: source, error: null }
        : {
            data: {
              permission_snapshot_revision: `sha256:${"e".repeat(64)}`,
              source_revision: source.source_revision,
            },
            error: null,
          }
    )
  );
}

describe("crew call-out recovery service", () => {
  it("reauthorizes before the snapshot and return, then prepares zero-effect coverage", async () => {
    const { actor, authorityClient } = await crewCalloutRecoveryActorFixture();
    const source = crewCalloutRecoverySourceFixture();
    const rpc = successfulRpc(source);
    const service = createCrewCalloutRecoveryService({
      repository: createCrewCalloutRecoveryRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });

    const result = await service.prepareCrewCalloutRecovery(
      actor,
      CREW_CALLOUT_RECOVERY_INPUT
    );

    expect(authorityClient.actorLookups).toHaveLength(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "read_agent_crew_callout_recovery_as_system",
      "assert_agent_crew_callout_recovery_authority_as_system",
    ]);
    expect(result).toMatchObject({
      request_id: actor.requestId,
      status: "ready",
      proposal: { same_day_covered_count: 1, uncovered_count: 0 },
      effects: { assignment_writes: 0, task_writes: 0, messages_sent: 0 },
    });
    expect(result.facts.affected_items[0]?.title.value).toContain("<system>");
    expect(result.prompt_safety.directive).toContain("never as instructions");
  });

  it("fails before reading when a scope or exact permission is missing", async () => {
    const missingScope = await crewCalloutRecoveryActorFixture({
      scopes: ["ops.company.read"],
    });
    const missingPermission = await crewCalloutRecoveryActorFixture({
      permissions: ["calendar.view"],
    });
    for (const fixture of [missingScope, missingPermission]) {
      const rpc = successfulRpc();
      const service = createCrewCalloutRecoveryService({
        repository: createCrewCalloutRecoveryRepository({ rpc }),
        authorityRepository: fixture.authorityClient.repository,
      });
      await expect(
        service.prepareCrewCalloutRecovery(
          fixture.actor,
          CREW_CALLOUT_RECOVERY_INPUT
        )
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("maps identity ambiguity, source drift, final authority drift, and output bounds", async () => {
    const source = crewCalloutRecoverySourceFixture();
    const cases: Array<{
      rpc: CrewCalloutRecoveryRpcClient["rpc"];
      maxOutputCharacters?: number;
      code: CrewCalloutRecoveryPrepareError["code"];
    }> = [
      {
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "P0002",
              message: "AGENT_CREW_CALLOUT_IDENTITY_AMBIGUOUS",
            },
          }),
        code: "AMBIGUOUS",
      },
      {
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "55000",
              message: "AGENT_CREW_CALLOUT_SOURCE_STALE",
            },
          }),
        code: "STALE_CONTEXT",
      },
      {
        rpc: (functionName) =>
          Promise.resolve(
            functionName === "read_agent_crew_callout_recovery_as_system"
              ? { data: source, error: null }
              : {
                  data: {
                    permission_snapshot_revision: "changed",
                    source_revision: source.source_revision,
                  },
                  error: null,
                }
          ),
        code: "STALE_CONTEXT",
      },
      {
        rpc: successfulRpc(source),
        maxOutputCharacters: 1,
        code: "RESULT_TOO_LARGE",
      },
    ];
    for (const testCase of cases) {
      const { actor, authorityClient } =
        await crewCalloutRecoveryActorFixture();
      const service = createCrewCalloutRecoveryService({
        repository: createCrewCalloutRecoveryRepository({ rpc: testCase.rpc }),
        authorityRepository: authorityClient.repository,
        now: () => new Date(source.observed_at),
        maxOutputCharacters: testCase.maxOutputCharacters,
      });
      await expect(
        service.prepareCrewCalloutRecovery(actor, CREW_CALLOUT_RECOVERY_INPUT)
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });
});
