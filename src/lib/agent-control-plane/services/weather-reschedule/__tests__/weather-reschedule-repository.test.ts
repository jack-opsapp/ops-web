import { describe, expect, it, vi } from "vitest";

import {
  WeatherRescheduleRepositoryAuthorityError,
  WeatherRescheduleRepositoryBoundError,
  WeatherRescheduleRepositoryInputError,
  WeatherRescheduleRepositoryStaleError,
  WeatherRescheduleRepositoryUnavailableError,
  createWeatherRescheduleRepository,
  type WeatherRescheduleRpcClient,
} from "../weather-reschedule-repository";
import {
  ACTOR_USER_ID,
  COMPANY_ID,
  OAUTH_CLIENT_ID,
  OAUTH_GRANT_ID,
  WEATHER_RESCHEDULE_INPUT,
  WEATHER_RESCHEDULE_SCOPES,
  weatherRescheduleActorFixture,
  weatherRescheduleSourceFixture,
} from "./fixtures";

describe("weather reschedule repository", () => {
  it("makes one abortable bounded read with the exact v17/v11 binding", async () => {
    const { actor } = await weatherRescheduleActorFixture();
    const source = weatherRescheduleSourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<WeatherRescheduleRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );

    await expect(
      createWeatherRescheduleRepository({ rpc }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        input: WEATHER_RESCHEDULE_INPUT,
        signal,
      })
    ).resolves.toEqual(source);

    expect(rpc).toHaveBeenCalledWith(
      "read_agent_weather_reschedule_as_system",
      {
        p_actor_user_id: ACTOR_USER_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: OAUTH_GRANT_ID,
        p_oauth_client_id: OAUTH_CLIENT_ID,
        p_grant_revision: "b".repeat(32),
        p_granted_scope_ceiling: WEATHER_RESCHEDULE_SCOPES,
        p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
        p_capability_manifest_revision: "2026-09-03.capability-manifest.v17",
        p_exposure_revision: "2026-09-03.mcp-exposure.v11",
        p_capability_id: "prepare_weather_reschedule",
        p_capability_revision: "prepare_weather_reschedule:2026-09-03.v1",
        p_observed_at: source.observed_at,
        p_target_date: WEATHER_RESCHEDULE_INPUT.target_date,
        p_task_limit: 101,
        p_project_limit: 26,
        p_conflict_limit: 501,
      }
    );
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("rejects wrong bindings, malformed envelopes, identity drift, and oversized snapshots", async () => {
    const { actor } = await weatherRescheduleActorFixture();
    const source = weatherRescheduleSourceFixture();
    await expect(
      createWeatherRescheduleRepository({
        rpc: () => Promise.resolve({ data: source, error: null }),
      }).readSourceSnapshot({
        actorContext: { ...actor, capabilityManifestRevision: "wrong" },
        observedAt: source.observed_at,
        input: WEATHER_RESCHEDULE_INPUT,
      })
    ).rejects.toThrow("Weather reschedule requires a v17 MCP actor");

    for (const data of [
      null,
      { ...source, observed_at: "2026-09-03T12:00:01Z" },
      { ...source, target_date: "2026-09-04" },
      { ...source, source_revision: "invalid" },
      {
        ...source,
        context: { ...source.context, company_id: OAUTH_CLIENT_ID },
      },
      {
        ...source,
        context: { ...source.context, company_name: "x".repeat(1_000_001) },
      },
    ]) {
      await expect(
        createWeatherRescheduleRepository({
          rpc: () => Promise.resolve({ data, error: null }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          input: WEATHER_RESCHEDULE_INPUT,
        })
      ).rejects.toBeInstanceOf(WeatherRescheduleRepositoryUnavailableError);
    }
  });

  it("normalizes authority, input, stale, bound, and storage failures", async () => {
    const { actor } = await weatherRescheduleActorFixture();
    const source = weatherRescheduleSourceFixture();
    const cases = [
      [
        { code: "42501", message: "denied" },
        WeatherRescheduleRepositoryAuthorityError,
      ],
      [
        { code: "22023", message: "AGENT_WEATHER_RESCHEDULE_INPUT_INVALID" },
        WeatherRescheduleRepositoryInputError,
      ],
      [
        { code: "55000", message: "AGENT_WEATHER_RESCHEDULE_SOURCE_STALE" },
        WeatherRescheduleRepositoryStaleError,
      ],
      [
        { code: "54000", message: "AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND" },
        WeatherRescheduleRepositoryBoundError,
      ],
      [
        { code: "XX000", message: "storage" },
        WeatherRescheduleRepositoryUnavailableError,
      ],
    ] as const;
    for (const [error, ErrorType] of cases) {
      await expect(
        createWeatherRescheduleRepository({
          rpc: () => Promise.resolve({ data: null, error }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          input: WEATHER_RESCHEDULE_INPUT,
        })
      ).rejects.toBeInstanceOf(ErrorType);
    }
  });

  it("deep-freezes accepted data and independently binds final authority to the source revision", async () => {
    const { actor } = await weatherRescheduleActorFixture();
    const source = weatherRescheduleSourceFixture();
    const rpc = vi.fn<WeatherRescheduleRpcClient["rpc"]>((functionName) =>
      Promise.resolve(
        functionName === "read_agent_weather_reschedule_as_system"
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
    const repository = createWeatherRescheduleRepository({ rpc });
    const accepted = await repository.readSourceSnapshot({
      actorContext: actor,
      observedAt: source.observed_at,
      input: WEATHER_RESCHEDULE_INPUT,
    });
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.tasks)).toBe(true);
    expect(Object.isFrozen(accepted.tasks[0])).toBe(true);
    expect(Object.isFrozen(accepted.tasks[0]?.recipient)).toBe(true);

    await expect(
      repository.assertCurrentAuthority({
        actorContext: actor,
        input: WEATHER_RESCHEDULE_INPUT,
        observedAt: source.observed_at,
        expectedSourceRevision: source.source_revision,
      })
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith(
      "assert_agent_weather_reschedule_authority_as_system",
      expect.objectContaining({
        p_observed_at: source.observed_at,
        p_target_date: WEATHER_RESCHEDULE_INPUT.target_date,
        p_expected_source_revision: source.source_revision,
      })
    );
  });
});
