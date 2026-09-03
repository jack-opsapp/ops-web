import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import {
  WEATHER_RESCHEDULE_CAPABILITY_REVISION,
  WEATHER_RESCHEDULE_MAX_CONFLICTS,
  WEATHER_RESCHEDULE_MAX_PROJECTS,
  WEATHER_RESCHEDULE_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  WEATHER_RESCHEDULE_MAX_TASKS,
  WeatherRescheduleSourceSnapshotSchema,
  type PrepareWeatherRescheduleInput,
  type WeatherRescheduleSourceSnapshot,
} from "@/lib/agent-control-plane/contracts/weather-reschedule";
import { WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V11 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RpcRequest extends PromiseLike<RpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
}

export interface WeatherRescheduleRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class WeatherRescheduleRepositoryUnavailableError extends Error {
  constructor() {
    super("Weather reschedule source is unavailable");
    this.name = "WeatherRescheduleRepositoryUnavailableError";
  }
}

export class WeatherRescheduleRepositoryAuthorityError extends Error {
  constructor() {
    super("Weather reschedule authority changed");
    this.name = "WeatherRescheduleRepositoryAuthorityError";
  }
}

export class WeatherRescheduleRepositoryInputError extends Error {
  constructor() {
    super("Weather reschedule input is invalid");
    this.name = "WeatherRescheduleRepositoryInputError";
  }
}

export class WeatherRescheduleRepositoryStaleError extends Error {
  constructor() {
    super("Weather reschedule source changed or is stale");
    this.name = "WeatherRescheduleRepositoryStaleError";
  }
}

export class WeatherRescheduleRepositoryBoundError extends Error {
  constructor() {
    super("Weather reschedule source exceeds its safe bound");
    this.name = "WeatherRescheduleRepositoryBoundError";
  }
}

function errorShape(error: unknown): { code: string; message: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const value = error as Readonly<Record<string, unknown>>;
  return {
    code: typeof value.code === "string" ? value.code : "",
    message: typeof value.message === "string" ? value.message : "",
  };
}

function normalizeRpcError(error: unknown): Error {
  const value = errorShape(error);
  if (
    value?.code === "42501" ||
    value?.message.startsWith("AGENT_WEATHER_RESCHEDULE_AUTHORITY") ||
    value?.message.startsWith("AGENT_WEATHER_RESCHEDULE_GRANT") ||
    value?.message.startsWith("AGENT_WEATHER_RESCHEDULE_BINDING")
  ) {
    return new WeatherRescheduleRepositoryAuthorityError();
  }
  if (
    value?.code === "22023" &&
    value.message.startsWith("AGENT_WEATHER_RESCHEDULE_INPUT_INVALID")
  ) {
    return new WeatherRescheduleRepositoryInputError();
  }
  if (
    value?.code === "55000" &&
    value.message.startsWith("AGENT_WEATHER_RESCHEDULE_SOURCE_STALE")
  ) {
    return new WeatherRescheduleRepositoryStaleError();
  }
  if (
    value?.code === "54000" &&
    value.message.startsWith("AGENT_WEATHER_RESCHEDULE_SOURCE_BOUND")
  ) {
    return new WeatherRescheduleRepositoryBoundError();
  }
  return new WeatherRescheduleRepositoryUnavailableError();
}

function binding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Weather reschedule requires a v17 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_capability_manifest_revision:
      WEATHER_RESCHEDULE_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V11.revision,
    p_capability_id: "prepare_weather_reschedule",
    p_capability_revision: WEATHER_RESCHEDULE_CAPABILITY_REVISION,
  } as const;
}

function timestampNanoseconds(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(
    value
  );
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds)) return null;
  return (
    BigInt(milliseconds) * BigInt(1_000_000) +
    BigInt((match[2] ?? "").padEnd(9, "0"))
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const FinalAuthorityResultSchema = z
  .object({
    permission_snapshot_revision: z.string().min(1).max(256),
    source_revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

async function execute(
  request: RpcRequest,
  signal?: AbortSignal
): Promise<RpcResult> {
  return signal && request.abortSignal
    ? await request.abortSignal(signal)
    : await request;
}

export interface WeatherRescheduleRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareWeatherRescheduleInput;
    signal?: AbortSignal;
  }): Promise<WeatherRescheduleSourceSnapshot>;
  assertCurrentAuthority(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareWeatherRescheduleInput;
    expectedSourceRevision: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createWeatherRescheduleRepository(input: {
  rpc: WeatherRescheduleRpcClient["rpc"];
}): WeatherRescheduleRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A weather reschedule RPC client is required");
  }

  const repository: WeatherRescheduleRepository = {
    async readSourceSnapshot(readInput) {
      const response = await execute(
        input.rpc("read_agent_weather_reschedule_as_system", {
          ...binding(readInput.actorContext),
          p_observed_at: readInput.observedAt,
          p_target_date: readInput.input.target_date,
          p_task_limit: WEATHER_RESCHEDULE_MAX_TASKS + 1,
          p_project_limit: WEATHER_RESCHEDULE_MAX_PROJECTS + 1,
          p_conflict_limit: WEATHER_RESCHEDULE_MAX_CONFLICTS + 1,
        }),
        readInput.signal
      );
      if (response.error) throw normalizeRpcError(response.error);

      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(response.data);
      } catch {
        throw new WeatherRescheduleRepositoryUnavailableError();
      }
      const parsed = WeatherRescheduleSourceSnapshotSchema.safeParse(response.data);
      if (
        serialized === undefined ||
        serialized.length > WEATHER_RESCHEDULE_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !parsed.success ||
        timestampNanoseconds(parsed.data.observed_at) !==
          timestampNanoseconds(readInput.observedAt) ||
        parsed.data.context.company_id !== readInput.actorContext.companyId ||
        parsed.data.target_date !== readInput.input.target_date
      ) {
        throw new WeatherRescheduleRepositoryUnavailableError();
      }
      return deepFreeze(parsed.data);
    },

    async assertCurrentAuthority(assertInput) {
      const response = await execute(
        input.rpc("assert_agent_weather_reschedule_authority_as_system", {
          ...binding(assertInput.actorContext),
          p_observed_at: assertInput.observedAt,
          p_target_date: assertInput.input.target_date,
          p_expected_source_revision: assertInput.expectedSourceRevision,
          p_task_limit: WEATHER_RESCHEDULE_MAX_TASKS + 1,
          p_project_limit: WEATHER_RESCHEDULE_MAX_PROJECTS + 1,
          p_conflict_limit: WEATHER_RESCHEDULE_MAX_CONFLICTS + 1,
        }),
        assertInput.signal
      );
      if (response.error) throw normalizeRpcError(response.error);
      const parsed = FinalAuthorityResultSchema.safeParse(response.data);
      if (
        !parsed.success ||
        parsed.data.permission_snapshot_revision !==
          assertInput.actorContext.permissionSnapshotRevision ||
        parsed.data.source_revision !== assertInput.expectedSourceRevision
      ) {
        throw new WeatherRescheduleRepositoryAuthorityError();
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedWeatherRescheduleRepository(
  value: unknown
): value is WeatherRescheduleRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
