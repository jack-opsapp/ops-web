import "server-only";

import { z } from "zod-v4";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import { REGISTERED_ACTOR_PERMISSION_KEYS } from "@/lib/agent-control-plane/actor/authority-repository";
import {
  CREW_CALLOUT_RECOVERY_CAPABILITY_REVISION,
  CREW_CALLOUT_RECOVERY_MAX_CANDIDATES,
  CREW_CALLOUT_RECOVERY_MAX_ITEMS,
  CREW_CALLOUT_RECOVERY_MAX_SOURCE_SNAPSHOT_CHARACTERS,
  CrewCalloutRecoverySourceSnapshotSchema,
  type CrewCalloutRecoverySourceSnapshot,
  type PrepareCrewCalloutRecoveryInput,
} from "@/lib/agent-control-plane/contracts/crew-callout-recovery";
import { CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION } from "@/lib/agent-control-plane/registry/capability-manifest";
import { MCP_EXPOSURE_V12 } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface RpcRequest extends PromiseLike<RpcResult> {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResult>;
}

export interface CrewCalloutRecoveryRpcClient {
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>
  ): RpcRequest;
}

const TRUSTED_REPOSITORIES = new WeakSet<object>();

export class CrewCalloutRecoveryRepositoryUnavailableError extends Error {
  constructor() {
    super("Crew call-out source is unavailable");
    this.name = "CrewCalloutRecoveryRepositoryUnavailableError";
  }
}

export class CrewCalloutRecoveryRepositoryAmbiguityError extends Error {
  constructor() {
    super("Crew member identity is ambiguous");
    this.name = "CrewCalloutRecoveryRepositoryAmbiguityError";
  }
}

export class CrewCalloutRecoveryRepositoryAuthorityError extends Error {
  constructor() {
    super("Crew call-out authority changed");
    this.name = "CrewCalloutRecoveryRepositoryAuthorityError";
  }
}

export class CrewCalloutRecoveryRepositoryInputError extends Error {
  constructor() {
    super("Crew call-out input is invalid");
    this.name = "CrewCalloutRecoveryRepositoryInputError";
  }
}

export class CrewCalloutRecoveryRepositoryStaleError extends Error {
  constructor() {
    super("Crew call-out source changed or is stale");
    this.name = "CrewCalloutRecoveryRepositoryStaleError";
  }
}

export class CrewCalloutRecoveryRepositoryBoundError extends Error {
  constructor() {
    super("Crew call-out source exceeds its safe bound");
    this.name = "CrewCalloutRecoveryRepositoryBoundError";
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
    value?.code === "P0002" &&
    value.message.startsWith("AGENT_CREW_CALLOUT_IDENTITY_")
  ) {
    return new CrewCalloutRecoveryRepositoryAmbiguityError();
  }
  if (
    value?.code === "42501" ||
    value?.message.startsWith("AGENT_CREW_CALLOUT_AUTHORITY") ||
    value?.message.startsWith("AGENT_CREW_CALLOUT_GRANT") ||
    value?.message.startsWith("AGENT_CREW_CALLOUT_BINDING")
  ) {
    return new CrewCalloutRecoveryRepositoryAuthorityError();
  }
  if (
    value?.code === "22023" &&
    value.message.startsWith("AGENT_CREW_CALLOUT_INPUT_INVALID")
  ) {
    return new CrewCalloutRecoveryRepositoryInputError();
  }
  if (
    value?.code === "55000" &&
    value.message.startsWith("AGENT_CREW_CALLOUT_SOURCE_STALE")
  ) {
    return new CrewCalloutRecoveryRepositoryStaleError();
  }
  if (
    value?.code === "54000" &&
    value.message.startsWith("AGENT_CREW_CALLOUT_SOURCE_BOUND")
  ) {
    return new CrewCalloutRecoveryRepositoryBoundError();
  }
  return new CrewCalloutRecoveryRepositoryUnavailableError();
}

function binding(actorContext: ActorContext) {
  if (
    actorContext.auth.channel !== "mcp" ||
    actorContext.capabilityManifestRevision !==
      CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION
  ) {
    throw new TypeError("Crew call-out recovery requires a v18 MCP actor");
  }
  return {
    p_actor_user_id: actorContext.actorUserId,
    p_company_id: actorContext.companyId,
    p_oauth_grant_id: actorContext.auth.oauthGrantId,
    p_oauth_client_id: actorContext.auth.oauthClientId,
    p_grant_revision: actorContext.auth.grantRevision,
    p_granted_scope_ceiling: [...actorContext.auth.scopeCeiling],
    p_permission_snapshot_revision: actorContext.permissionSnapshotRevision,
    p_registered_permission_keys: [...REGISTERED_ACTOR_PERMISSION_KEYS],
    p_capability_manifest_revision:
      CREW_CALLOUT_RECOVERY_CAPABILITY_MANIFEST_REVISION,
    p_exposure_revision: MCP_EXPOSURE_V12.revision,
    p_capability_id: "prepare_crew_callout_recovery",
    p_capability_revision: CREW_CALLOUT_RECOVERY_CAPABILITY_REVISION,
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
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
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

export interface CrewCalloutRecoveryRepository {
  readSourceSnapshot(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareCrewCalloutRecoveryInput;
    signal?: AbortSignal;
  }): Promise<CrewCalloutRecoverySourceSnapshot>;
  assertCurrentAuthority(input: {
    actorContext: ActorContext;
    observedAt: string;
    input: PrepareCrewCalloutRecoveryInput;
    expectedSourceRevision: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export function createCrewCalloutRecoveryRepository(input: {
  rpc: CrewCalloutRecoveryRpcClient["rpc"];
}): CrewCalloutRecoveryRepository {
  if (!input || typeof input.rpc !== "function") {
    throw new TypeError("A crew call-out recovery RPC client is required");
  }
  const repository: CrewCalloutRecoveryRepository = {
    async readSourceSnapshot(readInput) {
      const response = await execute(
        input.rpc("read_agent_crew_callout_recovery_as_system", {
          ...binding(readInput.actorContext),
          p_observed_at: readInput.observedAt,
          p_crew_member_name: readInput.input.crew_member_name,
          p_target_date: readInput.input.target_date,
          p_item_limit: CREW_CALLOUT_RECOVERY_MAX_ITEMS + 1,
          p_candidate_limit: CREW_CALLOUT_RECOVERY_MAX_CANDIDATES + 1,
          p_schedule_source_limit: 501,
        }),
        readInput.signal
      );
      if (response.error) throw normalizeRpcError(response.error);
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(response.data);
      } catch {
        throw new CrewCalloutRecoveryRepositoryUnavailableError();
      }
      const parsed = CrewCalloutRecoverySourceSnapshotSchema.safeParse(
        response.data
      );
      if (
        serialized === undefined ||
        serialized.length >
          CREW_CALLOUT_RECOVERY_MAX_SOURCE_SNAPSHOT_CHARACTERS ||
        !parsed.success ||
        timestampNanoseconds(parsed.data.observed_at) !==
          timestampNanoseconds(readInput.observedAt) ||
        parsed.data.context.company_id !== readInput.actorContext.companyId ||
        parsed.data.context.target_date !== readInput.input.target_date
      ) {
        throw new CrewCalloutRecoveryRepositoryUnavailableError();
      }
      return deepFreeze(parsed.data);
    },

    async assertCurrentAuthority(assertInput) {
      const response = await execute(
        input.rpc("assert_agent_crew_callout_recovery_authority_as_system", {
          ...binding(assertInput.actorContext),
          p_observed_at: assertInput.observedAt,
          p_crew_member_name: assertInput.input.crew_member_name,
          p_target_date: assertInput.input.target_date,
          p_expected_source_revision: assertInput.expectedSourceRevision,
          p_item_limit: CREW_CALLOUT_RECOVERY_MAX_ITEMS + 1,
          p_candidate_limit: CREW_CALLOUT_RECOVERY_MAX_CANDIDATES + 1,
          p_schedule_source_limit: 501,
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
        throw new CrewCalloutRecoveryRepositoryAuthorityError();
      }
    },
  };
  TRUSTED_REPOSITORIES.add(repository);
  return Object.freeze(repository);
}

export function isTrustedCrewCalloutRecoveryRepository(
  value: unknown
): value is CrewCalloutRecoveryRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    TRUSTED_REPOSITORIES.has(value)
  );
}
