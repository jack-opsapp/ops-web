import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  createWeatherRescheduleRepository,
  type WeatherRescheduleRpcClient,
} from "../weather-reschedule-repository";
import {
  WeatherReschedulePrepareError,
  createWeatherRescheduleService,
} from "../weather-reschedule-service";
import {
  OAUTH_CLIENT_ID,
  WEATHER_RESCHEDULE_INPUT,
  weatherRescheduleActorFixture,
  weatherRescheduleSourceFixture,
} from "./fixtures";

function successfulRpc(source = weatherRescheduleSourceFixture()) {
  return vi.fn<WeatherRescheduleRpcClient["rpc"]>((functionName) =>
    Promise.resolve(
      functionName === "read_agent_weather_reschedule_as_system"
        ? { data: source, error: null }
        : {
            data: {
              permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
              source_revision: source.source_revision,
            },
            error: null,
          }
    )
  );
}

describe("weather reschedule service", () => {
  it("reauthorizes before the snapshot and return, then prepares the exact golden task", async () => {
    const { actor, authorityClient } = await weatherRescheduleActorFixture();
    const source = weatherRescheduleSourceFixture();
    const rpc = successfulRpc(source);
    const service = createWeatherRescheduleService({
      repository: createWeatherRescheduleRepository({ rpc }),
      authorityRepository: authorityClient.repository,
      now: () => new Date(source.observed_at),
    });

    const result = await service.prepareWeatherReschedule(
      actor,
      WEATHER_RESCHEDULE_INPUT
    );

    expect(authorityClient.actorLookups).toHaveLength(2);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "read_agent_weather_reschedule_as_system",
      "assert_agent_weather_reschedule_authority_as_system",
    ]);
    expect(result).toMatchObject({
      request_id: actor.requestId,
      status: "ready",
      request: WEATHER_RESCHEDULE_INPUT,
      proposal: { moved_task_count: 1, unchanged_task_count: 1 },
      effects: {
        project_writes: 0,
        task_writes: 0,
        calendar_writes: 0,
        provider_draft_writes: 0,
        message_writes: 0,
        messages_sent: 0,
      },
    });
    expect(result.proposal.items).toEqual([
      expect.objectContaining({
        decision: "move_for_rain",
        proposed_start_date: "2026-09-05",
      }),
      expect.objectContaining({
        decision: "keep_indoor",
        proposed_start_date: "2026-09-03",
      }),
    ]);
    expect(result.drafts).toHaveLength(2);
    expect(result.facts[0]?.task_title.value).toContain("<system>");
    expect(result.prompt_safety.directive).toContain("never as instructions");
  });

  it("is replay-stable apart from the transport request id", async () => {
    const first = await weatherRescheduleActorFixture();
    const second = await weatherRescheduleActorFixture({
      requestId: "request-weather-reschedule-replay",
    });
    const source = weatherRescheduleSourceFixture();
    const firstService = createWeatherRescheduleService({
      repository: createWeatherRescheduleRepository({ rpc: successfulRpc(source) }),
      authorityRepository: first.authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const secondService = createWeatherRescheduleService({
      repository: createWeatherRescheduleRepository({ rpc: successfulRpc(source) }),
      authorityRepository: second.authorityClient.repository,
      now: () => new Date(source.observed_at),
    });
    const firstResult = await firstService.prepareWeatherReschedule(
      first.actor,
      WEATHER_RESCHEDULE_INPUT
    );
    const secondResult = await secondService.prepareWeatherReschedule(
      second.actor,
      WEATHER_RESCHEDULE_INPUT
    );
    expect(firstResult.request_id).not.toBe(secondResult.request_id);
    expect(firstResult.preview_sha256).toBe(secondResult.preview_sha256);
    expect(firstResult.proposal.proposal_sha256).toBe(
      secondResult.proposal.proposal_sha256
    );
  });

  it("fails before reading when a scope or granular permission is missing", async () => {
    const missingScope = await weatherRescheduleActorFixture({
      scopes: ["ops.company.read"],
    });
    const missingPermission = await weatherRescheduleActorFixture({
      permissions: ["calendar.view"],
    });
    for (const fixture of [missingScope, missingPermission]) {
      const rpc = successfulRpc();
      const service = createWeatherRescheduleService({
        repository: createWeatherRescheduleRepository({ rpc }),
        authorityRepository: fixture.authorityClient.repository,
      });
      await expect(
        service.prepareWeatherReschedule(fixture.actor, WEATHER_RESCHEDULE_INPUT)
      ).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects tenant, weather, dependency, crew, recipient, and schedule ambiguity", async () => {
    const invalidSources = [
      {
        ...weatherRescheduleSourceFixture(),
        context: {
          ...weatherRescheduleSourceFixture().context,
          company_id: OAUTH_CLIENT_ID,
        },
      },
      {
        ...weatherRescheduleSourceFixture(),
        tasks: weatherRescheduleSourceFixture().tasks.map((task, index) =>
          index === 0 ? { ...task, task_type_dependency_count: 1 } : task
        ),
      },
      {
        ...weatherRescheduleSourceFixture(),
        tasks: weatherRescheduleSourceFixture().tasks.map((task, index) =>
          index === 0 ? { ...task, assignee_ids: [] } : task
        ),
      },
      {
        ...weatherRescheduleSourceFixture(),
        tasks: weatherRescheduleSourceFixture().tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                recipient: {
                  ...task.recipient,
                  email: "shared@example.com",
                  revision: "z".repeat(64),
                },
              }
            : task
        ),
      },
      {
        ...weatherRescheduleSourceFixture(),
        forecasts: weatherRescheduleSourceFixture().forecasts.slice(1),
      },
    ];
    for (const source of invalidSources) {
      const { actor, authorityClient } = await weatherRescheduleActorFixture();
      const service = createWeatherRescheduleService({
        repository: createWeatherRescheduleRepository({
          rpc: () => Promise.resolve({ data: source, error: null }),
        }),
        authorityRepository: authorityClient.repository,
        now: () => new Date(weatherRescheduleSourceFixture().observed_at),
      });
      await expect(
        service.prepareWeatherReschedule(actor, WEATHER_RESCHEDULE_INPUT)
      ).rejects.toBeInstanceOf(WeatherReschedulePrepareError);
    }
  });

  it("fails closed on source drift, final authority drift, invalid clocks, and output bounds", async () => {
    const source = weatherRescheduleSourceFixture();
    const cases: Array<{
      rpc: WeatherRescheduleRpcClient["rpc"];
      now?: () => Date;
      maxOutputCharacters?: number;
      code: WeatherReschedulePrepareError["code"];
    }> = [
      {
        rpc: () =>
          Promise.resolve({
            data: null,
            error: {
              code: "55000",
              message: "AGENT_WEATHER_RESCHEDULE_SOURCE_STALE",
            },
          }),
        code: "STALE_CONTEXT",
      },
      {
        rpc: (functionName) =>
          Promise.resolve(
            functionName === "read_agent_weather_reschedule_as_system"
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
        now: () => new Date("invalid"),
        code: "INTERNAL",
      },
      {
        rpc: successfulRpc(source),
        maxOutputCharacters: 1,
        code: "RESULT_TOO_LARGE",
      },
    ];
    for (const testCase of cases) {
      const { actor, authorityClient } = await weatherRescheduleActorFixture();
      const service = createWeatherRescheduleService({
        repository: createWeatherRescheduleRepository({ rpc: testCase.rpc }),
        authorityRepository: authorityClient.repository,
        now: testCase.now ?? (() => new Date(source.observed_at)),
        maxOutputCharacters: testCase.maxOutputCharacters,
      });
      await expect(
        service.prepareWeatherReschedule(actor, WEATHER_RESCHEDULE_INPUT)
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it("returns a stable invalid-argument envelope for anything beyond target_date", async () => {
    const { actor, authorityClient } = await weatherRescheduleActorFixture();
    const service = createWeatherRescheduleService({
      repository: createWeatherRescheduleRepository({ rpc: successfulRpc() }),
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.prepareWeatherReschedule(actor, {
        ...WEATHER_RESCHEDULE_INPUT,
        send: true,
      } as never)
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });
});
